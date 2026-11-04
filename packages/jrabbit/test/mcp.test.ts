import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, formatPin, searchHints } from "../src/server/mcp.js";
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

  const server = createMcpServer(store, review, "test");
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
      ["get_feedback", "list_feedback", "list_rules", "open_review", "propose_rule", "reopen_feedback", "resolve_feedback", "status", "wait_for_feedback"],
    );
    for (const t of tools) expect(t.annotations?.openWorldHint).toBe(false);
    expect(byName.status?.annotations?.readOnlyHint).toBe(true);
    expect(byName.list_feedback?.annotations?.readOnlyHint).toBe(true);
    expect(byName.resolve_feedback?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
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
    const res = await call("open_review", { url: targetUrl(), open: false });
    expect(res.isError).toBeFalsy();
    expect(res.json.reviewUrl).toMatch(/^http:\/\/localhost:\d+/);
    expect(review.origin).not.toBeNull();
  });

  it("times out with a next step when nothing is sent", async () => {
    const res = await call("wait_for_feedback", { timeout_seconds: 1 });
    expect(res.json).toMatchObject({ status: "timeout", drafts: 0, overlayConnected: false });
    expect(res.json.next).toContain("No browser is connected");
  });

  it("caps the wait under the default client tool timeout", async () => {
    const res = await call("wait_for_feedback", { timeout_seconds: 600 });
    expect(res.isError).toBe(true);
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
