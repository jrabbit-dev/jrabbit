import http from "node:http";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";
import { afterShotTimeout, clientRoot, createMcpServer, formatPin, searchHints, waitCap } from "../src/server/mcp.js";
import { ReviewServer } from "../src/server/review.js";
import { Store } from "../src/server/store.js";
import type { Pin } from "../src/shared/types.js";

let target: http.Server;
let store: Store;
let review: ReviewServer;
let client: Client;

const targetUrl = () => `http://127.0.0.1:${(target.address() as AddressInfo).port}/`;

/** Tool results are JSON text in the first content block. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const first = res.content[0]?.text ?? "";
  let json: any = null;
  try {
    json = JSON.parse(first);
  } catch {
    // plain text (errors)
  }
  return { ...res, text: first, json };
}

/** What the overlay does: create a draft pin, then press Send. */
async function humanSends(comment: string) {
  const headers = { "content-type": "application/json", "x-jrabbit-token": review.token };
  const base = review.origin!;
  const pin = {
    comment,
    page: { url: `${base}/`, path: "/", title: "t" },
    viewport: { width: 1280, height: 800, dpr: 1 },
    element: { selector: "main > h1", tag: "h1", text: "Pricing", attrs: { "data-testid": "hero-title" }, rect: { x: 0, y: 0, width: 200, height: 40 } },
    debug: [],
  };
  const created = await fetch(`${base}/__jrabbit/api/pins`, { method: "POST", headers, body: JSON.stringify(pin) });
  expect(created.status).toBe(200);
  const sent = await fetch(`${base}/__jrabbit/api/send`, { method: "POST", headers, body: "{}" });
  expect(await sent.json()).toEqual({ sent: 1 });
}

beforeAll(async () => {
  target = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html><head></head><body>app</body></html>"));
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "jrabbit-mcp-"));
  const overlay = join(root, "overlay.js");
  writeFileSync(overlay, "/* overlay */");
  store = new Store(root);
  review = new ReviewServer(store, overlay);

  // Short budget so the test with a silent browser ends quickly.
  const server = createMcpServer(store, review, "test", { afterShotBudgetMs: 1500 });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  await review.stop();
  await new Promise((r) => target.close(r));
});

describe("MCP server", () => {
  it("lists every tool with annotations", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      [
        "archive_feedback",
        "close_review",
        "delete_rule",
        "get_feedback",
        "list_feedback",
        "list_rules",
        "open_review",
        "propose_rule",
        "reopen_feedback",
        "resolve_feedback",
        "status",
        "update_rule",
        "wait_for_feedback",
      ],
    );
    for (const t of tools) expect(t.annotations?.openWorldHint).toBe(false);
    expect(byName.status?.annotations?.readOnlyHint).toBe(true);
    expect(byName.list_feedback?.annotations?.readOnlyHint).toBe(true);
    expect(byName.resolve_feedback?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(byName.delete_rule?.annotations?.destructiveHint).toBe(true);
  });

  it("offers a review prompt", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("review");
    const prompt = await client.getPrompt({ name: "review", arguments: { url: targetUrl() } });
    expect(JSON.stringify(prompt.messages)).toContain(targetUrl());
  });

  it("marks the agent as connected once initialized", () => {
    expect(review.agent).toBe("connected");
  });

  it("explains when nothing runs at the URL", async () => {
    const dead = http.createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    const port = (dead.address() as AddressInfo).port;
    await new Promise((r) => dead.close(r));

    const res = await call("open_review", { url: `http://127.0.0.1:${port}/`, open: false });
    expect(res.isError).toBe(true);
    expect(res.text).toContain("Nothing is answering");
    expect(review.origin).toBeNull();
  });

  it("rejects URLs that are not http", async () => {
    const res = await call("open_review", { url: "file:///etc/passwd", open: false });
    expect(res.isError).toBe(true);
  });

  it("opens a review of a running dev server", async () => {
    const res = await call("open_review", { url: targetUrl(), open: false, wait_seconds: 0 });
    expect(res.isError).toBeFalsy();
    expect(res.json.reviewUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(res.json.login).toContain("shares cookies");
    expect(res.json.next).toContain("Do not end your turn");
    expect(review.origin).not.toBeNull();
  });

  it("times out with a next step when nothing is sent", async () => {
    const res = await call("wait_for_feedback", { timeout_seconds: 1 });
    expect(res.json).toMatchObject({ status: "timeout", drafts: 0, overlayConnected: false });
    expect(res.json.next).toContain("Nobody has the review open");
  });

  it("rejects a wait longer than any client allows", async () => {
    const res = await call("wait_for_feedback", { timeout_seconds: 4000 });
    expect(res.isError).toBe(true);
  });

  it("reports the version and how long it waits for this client", async () => {
    const res = await call("status");
    expect(res.json).toMatchObject({ version: "test", waitSeconds: 55, closed: false });
  });

  it("wakes up when the human presses Send, and is listening meanwhile", async () => {
    const waiting = call("wait_for_feedback", { timeout_seconds: 10 });
    await new Promise((r) => setTimeout(r, 100));
    expect(review.agent).toBe("listening");
    const started = Date.now();
    await humanSends("Make the title bigger");
    const res = await waiting;
    expect(Date.now() - started).toBeLessThan(1500);
    expect(res.json.status).toBe("feedback");
    expect(res.json.pins).toHaveLength(1);
    expect(res.json.pins[0]).toMatchObject({ n: 1, comment: "Make the title bigger", source: null });
    expect(res.json.pins[0].find).toContain('data-testid="hero-title"');
  });

  it("does not hand the same pin out twice", async () => {
    const res = await call("wait_for_feedback", { timeout_seconds: 1 });
    expect(res.json.status).toBe("timeout");
  });

  it("returns pins sent before the agent started waiting", async () => {
    await humanSends("Fix the spacing");
    const res = await call("wait_for_feedback", { timeout_seconds: 1 });
    expect(res.json.pins.map((p: { n: number }) => p.n)).toEqual([2]);
  });

  it("resolves without a browser and says the after shot is missing", async () => {
    const res = await call("resolve_feedback", { id: "#1", summary: "Bumped h1 to 48px" });
    expect(res.isError).toBeFalsy();
    expect(res.json.pin.status).toBe("resolved");
    expect(res.json.afterShot).toBe("not captured (no browser connected)");
  });

  it("refuses to resolve a pin that does not exist", async () => {
    const res = await call("resolve_feedback", { id: "#99", summary: "x" });
    expect(res.isError).toBe(true);
  });

  it("reports status with the store location", async () => {
    const res = await call("status");
    expect(res.json).toMatchObject({ pins: { draft: 0, open: 1, resolved: 1, approved: 0 }, undelivered: 0, store: store.dir });
    expect(res.json.review.target).toBe(targetUrl().replace(/\/$/, ""));
  });

  it("resolves several pins in one call and reports the ones that failed", async () => {
    await humanSends("Third");
    await call("wait_for_feedback", { timeout_seconds: 1 });
    const res = await call("resolve_feedback", {
      pins: [
        { id: "#2", summary: "Spacing to 16px" },
        { id: "#3", summary: "Done" },
        { id: "#99", summary: "x" },
      ],
    });
    expect(res.isError).toBeFalsy();
    expect(res.json.resolved.map((r: { pin: { n: number } }) => r.pin.n)).toEqual([2, 3]);
    expect(res.json.errors).toHaveLength(1);
    expect((await store.getPin("#3"))?.status).toBe("resolved");
  });

  it("caps the wait for after shots when the browser is on another page", async () => {
    // A connected overlay that never answers, like one showing a different page.
    const sse = http.get(`${review.origin}/__jrabbit/api/events?t=${review.token}`);
    await new Promise<void>((r) => sse.on("response", () => r()));
    try {
      const started = Date.now();
      const res = await call("resolve_feedback", {
        pins: [
          { id: "#1", summary: "a" },
          { id: "#2", summary: "b" },
          { id: "#3", summary: "c" },
        ],
      });
      expect(Date.now() - started).toBeLessThan(3000);
      expect(res.json.resolved.map((r: { afterShot: string }) => r.afterShot)).toEqual(["not captured", "not captured", "not captured"]);
      expect(res.json.notice).toContain("#1 #2 #3");
      expect(res.json.notice).toContain("another page than /");
    } finally {
      sse.destroy();
    }
  });

  it("refuses a resolve with neither id nor pins", async () => {
    const res = await call("resolve_feedback", { summary: "x" });
    expect(res.isError).toBe(true);
  });

  it("edits a rule back to draft and only deletes drafts", async () => {
    const proposed = await call("propose_rule", { title: "Use the accent", rule: "CTAs use --accent.", source: ["#1"] });
    const slug = proposed.json.slug ?? proposed.json.rule?.slug;
    expect(slug).toBeTruthy();
    await store.setRuleStatus(slug, "approved");

    const refused = await call("delete_rule", { slug });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Ask the human");

    const edited = await call("update_rule", { slug, rule: "Primary CTAs use --accent." });
    expect(JSON.stringify(edited.json)).toContain('"status":"draft"');

    const deleted = await call("delete_rule", { slug });
    expect(deleted.isError).toBeFalsy();
    expect(await store.readRule(slug)).toBeNull();
  });

  it("archives only approved pins", async () => {
    await store.updatePin((await store.getPin("#1"))!.id, (p) => store.setStatus(p, "approved", "human"));
    const res = await call("archive_feedback");
    expect(res.json.archived).toEqual(["#1"]);
    expect((await store.listPins()).map((p) => p.n)).toEqual([2, 3]);
  });

  it("waits for the first pins inside open_review, so the agent never idles", async () => {
    await humanSends("Make it the primary button");
    const res = await call("open_review", { url: targetUrl(), open: false, wait_seconds: 2 });
    expect(res.json.reviewUrl).toBeTruthy();
    const feedback = JSON.parse(res.content[1]?.text ?? "{}");
    expect(feedback.status).toBe("feedback");
    expect(feedback.pins.map((p: { comment: string }) => p.comment)).toEqual(["Make it the primary button"]);
    expect(feedback.next).toContain("without asking");
  });

  const api = (path: string, body: unknown = {}) =>
    fetch(`${review.origin}/__jrabbit/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-jrabbit-token": review.token },
      body: JSON.stringify(body),
    });
  const newPin = (comment: string, send?: boolean) => ({
    comment,
    send,
    page: { url: `${review.origin}/`, path: "/", title: "t" },
    viewport: { width: 1280, height: 800, dpr: 1 },
    element: { selector: "main > h1", tag: "h1", text: "Pricing", rect: { x: 0, y: 0, width: 200, height: 40 } },
    debug: [],
  });

  it("sends a pin in the same request that creates it, and wakes the agent", async () => {
    const waiting = call("wait_for_feedback", { timeout_seconds: 10 });
    await new Promise((r) => setTimeout(r, 100));
    const created = await api("/pins", newPin("Tighter", true));
    expect((await created.json()).status).toBe("open");
    const res = await waiting;
    expect(res.json.status).toBe("feedback");
    expect(res.json.pins.map((p: { comment: string }) => p.comment)).toEqual(["Tighter"]);
  });

  it("approves every resolved pin at once", async () => {
    const open = (await store.listPins()).filter((p) => p.status === "open");
    await call("resolve_feedback", { pins: open.map((p) => ({ id: p.id, summary: "Done" })) });
    const before = (await store.listPins()).filter((p) => p.status === "resolved").length;
    expect(before).toBeGreaterThan(1);
    expect(await (await api("/approve-all")).json()).toEqual({ approved: before });
    expect((await store.listPins()).some((p) => p.status === "resolved")).toBe(false);
  });

  it("stops a wait when the human presses Done", async () => {
    const waiting = call("wait_for_feedback", { timeout_seconds: 20 });
    await new Promise((r) => setTimeout(r, 100));
    await api("/done");
    const res = await waiting;
    expect(res.json.status).toBe("done");
    expect(res.json.next).toContain("Stop waiting");
    // Still ended: the next wait returns at once instead of blocking.
    expect((await call("wait_for_feedback", { timeout_seconds: 20 })).json.status).toBe("done");
  });

  it("starts again when the human sends another pin", async () => {
    await api("/pins", newPin("One more", true));
    expect(store.isClosed()).toBe(false);
    expect((await call("wait_for_feedback", { timeout_seconds: 1 })).json.status).toBe("feedback");
  });

  it("closes the review from the agent, and open_review reopens it", async () => {
    const res = await call("close_review");
    expect(res.json).toMatchObject({ closed: true });
    expect(store.isClosed()).toBe(true);
    await call("open_review", { url: targetUrl(), open: false, wait_seconds: 0 });
    expect(store.isClosed()).toBe(false);
  });

  it("stops waiting when the review is open but untouched for a long time", async () => {
    await store.beat("overlay");
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(join(store.dir, ".human"), old, old);
    const res = await call("wait_for_feedback", { timeout_seconds: 1 });
    expect(res.json.status).toBe("idle");
    expect(res.json.next).toContain("Stop waiting");
  });
});

describe("waitCap", () => {
  it("waits long in Claude Code and under 60 s everywhere else", () => {
    expect(waitCap("claude-code", undefined)).toBe(270);
    expect(waitCap("codex-mcp-client", undefined)).toBe(55);
    expect(waitCap(undefined, undefined)).toBe(55);
  });

  it("lets JRABBIT_WAIT_SECONDS override it, within an hour", () => {
    expect(waitCap("codex-mcp-client", "300")).toBe(300);
    expect(waitCap("claude-code", "99999")).toBe(3600);
    expect(waitCap("claude-code", "nope")).toBe(270);
  });
});

describe("client roots", () => {
  it("picks the first file:// directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "jrabbit-root-"));
    expect(clientRoot(["https://example.com", pathToFileURL(join(dir, "missing")).href, pathToFileURL(dir).href])).toBe(dir);
    expect(clientRoot([])).toBeNull();
  });

  it("uses the client's workspace as the project root", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jrabbit-ws-"));
    const s = new Store(join(tmpdir(), "jrabbit-cwd-unused"));
    const r = new ReviewServer(s, join(dir, "overlay.js"));
    const server = createMcpServer(s, r, "test", { clientRoots: true });
    const c = new Client({ name: "ide", version: "0" }, { capabilities: { roots: {} } });
    c.setRequestHandler(ListRootsRequestSchema, () => ({ roots: [{ uri: pathToFileURL(dir).href, name: "ws" }] }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(b), c.connect(a)]);
    const res = await c.callTool({ name: "status", arguments: {} });
    const json = JSON.parse((res.content as Array<{ text: string }>)[0]!.text);
    expect(json.store).toBe(join(dir, ".jrabbit"));
    await c.close();
  });
});

describe("search hints", () => {
  const el = (over: Partial<Pin["element"]> = {}): Pin["element"] => ({
    selector: "div",
    tag: "div",
    text: "",
    rect: { x: 0, y: 0, width: 1, height: 1 },
    ...over,
  });

  it("prefers stable attributes, then text, then readable classes", () => {
    const hints = searchHints(el({ attrs: { id: "cta", "aria-label": "Buy now" }, text: "Buy", classes: ["hero_title__a1b2c", "btn-primary", "css-1x2y3z"] }));
    expect(hints).toEqual(['id="cta"', 'aria-label="Buy now"', 'text "Buy"', "class btn-primary"]);
  });

  it("is only included when the source is unknown", () => {
    const pin = {
      source: { file: "app/page.tsx", line: 3 },
      sourceChain: [],
      element: el({ text: "Hi" }),
      page: { url: "http://localhost/", path: "/", title: "" },
      viewport: { width: 1, height: 1, dpr: 1 },
      shots: {},
      history: [],
    } as unknown as Pin;
    expect(formatPin(pin)).not.toHaveProperty("find");
  });
});

describe("afterShotTimeout", () => {
  it("gives later pins more time but never passes the batch budget", () => {
    expect(afterShotTimeout(0)).toBe(15_000);
    expect(afterShotTimeout(2)).toBe(23_000);
    // 20 pins used to wait up to 91 s, past the 60 s most clients allow.
    expect(Math.max(...Array.from({ length: 20 }, (_, i) => afterShotTimeout(i)))).toBeLessThanOrEqual(45_000);
    expect(afterShotTimeout(5, 1000)).toBe(1000);
  });
});
