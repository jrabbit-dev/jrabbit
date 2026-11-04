import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReviewServer } from "../src/server/review.js";
import { Store } from "../src/server/store.js";

let target: http.Server;
let review: ReviewServer;
let base: string;
const seen: http.IncomingHttpHeaders[] = [];

function request(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request(base + path, { method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

beforeAll(async () => {
  target = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/redirect") return res.writeHead(307, { location: `http://localhost:${port()}/login` }).end();
    res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>t</title></head><body>app</body></html>");
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "jrabbit-review-"));
  const store = new Store(root);
  await store.init();
  const overlay = join(root, "overlay.js");
  writeFileSync(overlay, "/* overlay */");
  review = new ReviewServer(store, overlay);
  const url = await review.start(`http://127.0.0.1:${port()}/`, 4800 + Math.floor(Math.random() * 100));
  base = url.replace(/\/$/, "");
});

afterAll(async () => {
  await review.stop();
  await new Promise((r) => target.close(r));
});

const port = () => (target.address() as AddressInfo).port;
const auth = () => ({ "content-type": "application/json", "x-jrabbit-token": review.token });

describe("ReviewServer", () => {
  it("proxies HTML with the overlay injected and the target as Host/Origin", async () => {
    const res = await request("/", { headers: { origin: base } });
    expect(res.status).toBe(200);
    expect(res.body).toContain(`<head><script src="/__jrabbit/overlay.js?t=${review.token}" data-jrabbit async></script><title>`);
    const last = seen.at(-1)!;
    expect(last.host).toBe(`127.0.0.1:${port()}`);
    expect(last.origin).toBe(`http://127.0.0.1:${port()}`);
  });

  it("rewrites redirects to the target back to the review origin", async () => {
    const res = await request("/redirect");
    expect(res.status).toBe(307);
    expect(res.headers.location).toBe(`${base}/login`);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const res = await request("/", { headers: { host: "evil.example" } });
    expect(res.status).toBe(403);
  });

  it("requires the token for the API", async () => {
    expect((await request("/__jrabbit/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await request("/__jrabbit/overlay.js")).status).toBe(200);
  });

  it("rejects non-JSON and cross-origin writes", async () => {
    const form = await request("/__jrabbit/api/send", {
      method: "POST",
      headers: { "content-type": "text/plain", "x-jrabbit-token": review.token },
      body: "{}",
    });
    expect(form.status).toBe(415);
    const cross = await request("/__jrabbit/api/send", { method: "POST", headers: { ...auth(), origin: "http://evil.example" }, body: "{}" });
    expect(cross.status).toBe(403);
  });

  it("creates a draft and sends it to the agent", async () => {
    const pin = {
      comment: "Make this bigger",
      page: { url: `${base}/`, path: "/", title: "t" },
      viewport: { width: 1280, height: 800, dpr: 1 },
      element: { selector: "h1", tag: "h1", text: "app", rect: { x: 0, y: 0, width: 1, height: 1 } },
      debug: [],
    };
    const created = await request("/__jrabbit/api/pins", { method: "POST", headers: auth(), body: JSON.stringify(pin) });
    expect(created.status).toBe(200);
    expect(JSON.parse(created.body)).toMatchObject({ n: 1, status: "draft" });

    const sent = new Promise((r) => review.once("sent", r));
    const res = await request("/__jrabbit/api/send", { method: "POST", headers: auth(), body: "{}" });
    expect(JSON.parse(res.body)).toEqual({ sent: 1 });
    expect(await sent).toHaveLength(1);
  });
});
