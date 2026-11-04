import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { Pin, PinStatus, Rule } from "../shared/types.js";
import { openBrowser } from "./open-browser.js";
import type { ReviewServer } from "./review.js";
import type { Store } from "./store.js";

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

const MAX_IMAGES = 8;

const INSTRUCTIONS = `jrabbit lets a human point at UI in their browser and leave feedback pins for you.

Loop:
1. open_review(url) with the app's dev server URL. Tell the human to pin what they want changed and press Send.
2. wait_for_feedback(). If it times out, call it again: the human may still be pinning.
3. For each pin, edit the code. pin.source is where the pointed element is written; sourceChain lists the owner components.
4. resolve_feedback(id, summary) for each pin. It captures an after screenshot: look at it and fix again if it is not right.
5. Go back to wait_for_feedback() for the next batch or for pins the human reopened.

Rules: call list_rules() before editing and follow every approved rule. When the human repeats the same correction, propose_rule() so it becomes a draft rule they can approve.
Never claim a human approved anything. Approving is done by the human in the browser.`;

export function formatPin(p: Pin) {
  const loc = (l: { file: string; line: number; column?: number; component?: string }) =>
    `${l.file}:${l.line}${l.column ? `:${l.column}` : ""}${l.component ? ` (${l.component})` : ""}`;
  return {
    id: p.id,
    n: p.n,
    status: p.status,
    comment: p.comment,
    notes: p.history.filter((h) => h.note).map((h) => `${h.by}: ${h.note}`),
    page: p.page.path,
    viewport: `${p.viewport.width}x${p.viewport.height}@${p.viewport.dpr}x`,
    element: {
      selector: p.element.selector,
      tag: p.element.tag,
      text: p.element.text,
      ...(p.element.component ? { component: p.element.component } : {}),
    },
    source: p.source ? loc(p.source) : null,
    sourceChain: p.sourceChain.map(loc),
    shots: p.shots,
    ...(p.resolution ? { resolution: p.resolution.summary } : {}),
  };
}

function formatRule(r: Rule) {
  return { slug: r.slug, title: r.title, status: r.status, rule: r.body, source: r.source, path: r.path };
}

async function pinContent(store: Store, pins: Pin[], kinds: Array<"before" | "after">): Promise<Content[]> {
  const out: Content[] = [];
  let images = 0;
  for (const p of pins) {
    for (const kind of kinds) {
      if (images >= MAX_IMAGES) break;
      const data = await store.readShotBase64(p.shots[kind]);
      if (!data) continue;
      out.push({ type: "text", text: `#${p.n} ${kind}:` });
      out.push({ type: "image", data, mimeType: "image/png" });
      images++;
    }
  }
  return out;
}

const text = (value: unknown): Content => ({
  type: "text",
  text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
});

const fail = (message: string) => ({ content: [text(message)], isError: true });

export function createMcpServer(store: Store, review: ReviewServer, version: string): McpServer {
  const server = new McpServer({ name: "jrabbit", version }, { instructions: INSTRUCTIONS });

  // Pins the human sent that the agent has not received yet.
  const undelivered = async () =>
    (await store.listPins()).filter((p) => p.status === "open" && !p.deliveredAt);

  const markDelivered = async (pins: Pin[]) => {
    const at = new Date().toISOString();
    for (const p of pins) await store.updatePin(p.id, (x) => void (x.deliveredAt = at));
  };

  server.registerTool(
    "open_review",
    {
      title: "Open review",
      description:
        "Open the app in the browser with the jrabbit overlay so the human can point at elements and comment. Proxies the dev server; the project's code is not modified. Returns the review URL.",
      inputSchema: {
        url: z.string().describe("Dev server URL, e.g. http://localhost:3000 or http://localhost:3000/pricing"),
        open: z.boolean().optional().describe("Open the browser (default true)"),
      },
    },
    async ({ url, open }) => {
      try {
        await store.init();
        const reviewUrl = await review.start(url);
        if (open !== false) openBrowser(reviewUrl);
        return {
          content: [
            text({
              reviewUrl,
              target: url,
              next: "Tell the human to open the review URL, press P (or Point) to pick elements, comment, and press Send. Then call wait_for_feedback.",
            }),
          ],
        };
      } catch (err) {
        return fail(`Could not open review: ${(err as Error).message}`);
      }
    },
  );

  server.registerTool(
    "wait_for_feedback",
    {
      title: "Wait for feedback",
      description:
        "Block until the human presses Send (or reopens a pin), then return the new pins with screenshots and source locations. Returns immediately if there are pins you have not received yet. On timeout, call it again.",
      inputSchema: {
        timeout_seconds: z.number().int().min(1).max(600).optional().describe("Default 50"),
      },
    },
    async ({ timeout_seconds }, extra) => {
      let pins = await undelivered();
      if (!pins.length) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            review.off("sent", done);
            extra.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, (timeout_seconds ?? 50) * 1000);
          review.on("sent", done);
          extra.signal.addEventListener("abort", done);
        });
        pins = await undelivered();
      }
      if (!pins.length) {
        const drafts = (await store.listPins()).filter((p) => p.status === "draft").length;
        return {
          content: [
            text({
              status: "timeout",
              drafts,
              overlayConnected: review.connectedClients > 0,
              next:
                review.connectedClients > 0
                  ? "Nothing sent yet. Call wait_for_feedback again."
                  : "No browser is connected. Call open_review, or ask the human to open the review URL.",
            }),
          ],
        };
      }
      await markDelivered(pins);
      const rules = (await store.listRules()).filter((r) => r.status === "approved");
      return {
        content: [
          text({
            status: "feedback",
            pins: pins.map(formatPin),
            approvedRules: rules.map(formatRule),
            next: "Edit the code for each pin, then call resolve_feedback(id, summary) for each one.",
          }),
          ...(await pinContent(store, pins, ["before"])),
        ],
      };
    },
  );

  server.registerTool(
    "list_feedback",
    {
      title: "List feedback",
      description: "List pins, optionally filtered by status. No images; use get_feedback for one pin with screenshots.",
      inputSchema: {
        status: z.enum(["draft", "open", "resolved", "approved"]).optional(),
        page: z.string().optional().describe("Only pins on this path, e.g. /pricing"),
      },
    },
    async ({ status, page }) => {
      const pins = (await store.listPins()).filter(
        (p) => (!status || p.status === (status as PinStatus)) && (!page || p.page.path === page),
      );
      return { content: [text({ count: pins.length, pins: pins.map(formatPin) })] };
    },
  );

  server.registerTool(
    "get_feedback",
    {
      title: "Get feedback",
      description: "Get one pin by id or number, with its before/after screenshots.",
      inputSchema: { id: z.string().describe("Pin id (pin_…) or number (3 or #3)") },
    },
    async ({ id }) => {
      const pin = await store.getPin(id);
      if (!pin) return fail(`No pin ${id}`);
      return { content: [text(formatPin(pin)), ...(await pinContent(store, [pin], ["before", "after"]))] };
    },
  );

  server.registerTool(
    "resolve_feedback",
    {
      title: "Resolve feedback",
      description:
        "Mark a pin as resolved after you changed the code. Captures an after screenshot in the human's browser and returns before/after so you can verify. Idempotent. This does not approve: only the human approves.",
      inputSchema: {
        id: z.string(),
        summary: z.string().min(1).describe("What you changed, in one or two sentences, for the human"),
      },
    },
    async ({ id, summary }) => {
      const found = await store.getPin(id);
      if (!found) return fail(`No pin ${id}`);
      if (found.status === "draft") return fail(`Pin #${found.n} is a draft: the human has not sent it yet.`);
      let pin =
        (await store.updatePin(found.id, (p) => {
          if (p.status !== "resolved" || p.resolution?.summary !== summary) {
            if (p.status !== "approved") store.setStatus(p, "resolved", "agent", summary);
            p.resolution = { summary, at: new Date().toISOString() };
          }
        })) ?? found;
      review.broadcastState();
      const after = await review.requestAfterShot(pin);
      if (after) pin = after;
      review.toast(`#${pin.n} resolved`);
      return {
        content: [
          text({
            pin: formatPin(pin),
            afterShot: pin.shots.after
              ? "captured"
              : review.connectedClients
                ? "not captured (element not found or timeout)"
                : "not captured (no browser connected)",
            next: "Compare before/after. If it is not right, fix it and resolve again. The human approves or reopens in the browser.",
          }),
          ...(await pinContent(store, [pin], ["before", "after"])),
        ],
      };
    },
  );

  server.registerTool(
    "reopen_feedback",
    {
      title: "Reopen feedback",
      description: "Reopen a resolved pin, e.g. when the after screenshot shows the change did not work.",
      inputSchema: { id: z.string(), reason: z.string().optional() },
    },
    async ({ id, reason }) => {
      const found = await store.getPin(id);
      if (!found) return fail(`No pin ${id}`);
      const pin = await store.updatePin(found.id, (p) => {
        if (p.status !== "draft") store.setStatus(p, "open", "agent", reason);
      });
      review.broadcastState();
      return { content: [text(formatPin(pin!))] };
    },
  );

  server.registerTool(
    "propose_rule",
    {
      title: "Propose rule",
      description:
        "Save a repeated correction as a draft rule in .jrabbit/rules/ (versioned with the repo). Drafts do not apply until the human approves them in the browser.",
      inputSchema: {
        title: z.string().min(3).describe("Short imperative title, e.g. 'No neutral grays'"),
        rule: z.string().min(3).describe("The rule, specific and checkable"),
        pins: z.array(z.string()).optional().describe("Pin ids or numbers this rule comes from"),
      },
    },
    async ({ title, rule, pins }) => {
      await store.init();
      const ids: string[] = [];
      for (const ref of pins ?? []) {
        const p = await store.getPin(ref);
        if (p) ids.push(p.id);
      }
      const created = await store.writeRule({ title, body: rule, source: ids });
      review.broadcastState();
      return {
        content: [text({ rule: formatRule(created), next: "Tell the human a draft rule is waiting for approval in the overlay." })],
      };
    },
  );

  server.registerTool(
    "list_rules",
    {
      title: "List rules",
      description: "List taste rules. Follow every approved rule when editing UI.",
      inputSchema: { status: z.enum(["draft", "approved"]).optional() },
    },
    async ({ status }) => {
      const rules = (await store.listRules()).filter((r) => !status || r.status === status);
      return { content: [text({ count: rules.length, rules: rules.map(formatRule) })] };
    },
  );

  server.registerTool(
    "status",
    {
      title: "Status",
      description: "Review state: URL, connected browsers, pin counts by status, rules.",
      inputSchema: {},
    },
    async () => {
      const pins = await store.listPins();
      const rules = await store.listRules();
      const count = (s: PinStatus) => pins.filter((p) => p.status === s).length;
      return {
        content: [
          text({
            review: review.origin ? { url: review.origin, target: review.target?.origin } : null,
            browsersConnected: review.connectedClients,
            pins: { draft: count("draft"), open: count("open"), resolved: count("resolved"), approved: count("approved") },
            undelivered: pins.filter((p) => p.status === "open" && !p.deliveredAt).length,
            rules: { draft: rules.filter((r) => r.status === "draft").length, approved: rules.filter((r) => r.status === "approved").length },
            store: store.dir,
          }),
        ],
      };
    },
  );

  return server;
}

export async function runMcp(store: Store, review: ReviewServer, version: string): Promise<void> {
  const server = createMcpServer(store, review, version);
  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await review.stop();
    process.exit(0);
  };
  process.stdin.on("close", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
