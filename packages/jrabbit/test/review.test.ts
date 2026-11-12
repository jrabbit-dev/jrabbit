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
let store: Store;
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
    if (req.url === "/cookie") return res.writeHead(200, { "set-cookie": ["sid=1; Path=/; Domain=127.0.0.1; HttpOnly"] }).end();
    if (req.url === "/redirect") return res.writeHead(307, { location: `http://localhost:${port()}/login` }).end();
    if (req.url === "/csp")
      return res
        .writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'none'", "content-security-policy-report-only": "default-src 'self'" })
        .end("<html><head></head></html>");
    if (req.url === "/csp.js") return res.writeHead(200, { "content-type": "text/javascript", "content-security-policy": "default-src 'none'" }).end("1");
    res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>t</title></head><body>app</body></html>");
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const root = mkdtempSync(join(tmpdir(), "jrabbit-review-"));
  store = new Store(root);
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

  it("drops the CSP only on HTML it injects into, so the overlay can load", async () => {
    const html = await request("/csp");
    expect(html.headers["content-security-policy"]).toBeUndefined();
    expect(html.headers["content-security-policy-report-only"]).toBe("default-src 'self'");
    expect(html.body).toContain("/__jrabbit/overlay.js");
    expect((await request("/csp.js")).headers["content-security-policy"]).toBe("default-src 'none'");
  });

  it("answers ping only with a valid token, so the overlay can tell restart from shutdown", async () => {
    expect((await request(`/__jrabbit/api/ping?t=${review.token}`)).status).toBe(200);
    expect((await request("/__jrabbit/api/ping?t=stale")).status).toBe(401);
  });

  it("refuses to review itself", async () => {
    await expect(review.start(base)).rejects.toThrow("this jrabbit review itself");
  });

  it("debounces the agent leaving so the indicator does not flicker between waits", async () => {
    review.setAgent("listening");
    review.setAgent("connected");
    expect(review.agent).toBe("listening");
    review.setAgent("listening");
    await new Promise((r) => setTimeout(r, 1600));
    expect(review.agent).toBe("listening");
    review.setAgent("connected");
  });

  it("rewrites redirects to the target back to the review origin", async () => {
    const res = await request("/redirect");
    expect(res.status).toBe(307);
    expect(res.headers.location).toBe(`${base}/login`);
  });

  it("uses the dev server's host name so both share the login cookies", async () => {
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await request("/cookie");
    expect(res.headers["set-cookie"]).toEqual(["sid=1; Path=/; HttpOnly"]);
  });

  it("lets the human discard rules and archive approved pins", async () => {
    const rule = await store.writeRule({ title: "Tmp rule", body: "x", source: [] });
    const del = await request(`/__jrabbit/api/rules/${rule.slug}`, { method: "DELETE", headers: auth() });
    expect(del.status).toBe(200);
    expect(await store.readRule(rule.slug)).toBeNull();
    const archive = await request("/__jrabbit/api/archive", { method: "POST", headers: auth(), body: "{}" });
    expect(JSON.parse(archive.body)).toEqual({ archived: 0 });
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

  const pinInput = (comment: string) => ({
    comment,
    page: { url: `${base}/`, path: "/", title: "t" },
    viewport: { width: 1280, height: 800, dpr: 1 },
    element: { selector: "h1", tag: "h1", text: "app", rect: { x: 0, y: 0, width: 1, height: 1 } },
    debug: [],
  });
  const post = (path: string, body: unknown) => request(`/__jrabbit/api${path}`, { method: "POST", headers: auth(), body: JSON.stringify(body) });

  it("sends a pin ahead of its before shot, and waits a moment for it on delivery", async () => {
    const created = JSON.parse((await post("/pins", { ...pinInput("Later shot"), shotLater: true, send: true })).body);
    expect(created).toMatchObject({ status: "open", shotPending: true });
    expect(created.shots.before).toBeUndefined();

    // The shot lands while the delivery is waiting for it.
    setTimeout(() => void post(`/pins/${created.id}/before`, { shot: "data:image/png;base64,iVBORw0KGgo=" }), 150);
    const [settled] = await store.settleShots([created], 2000);
    expect(settled!.shotPending).toBeUndefined();
    expect(settled!.shots.before).toContain(`${created.id}-before.png`);

    // Only once: a second upload cannot replace the shot.
    expect((await post(`/pins/${created.id}/before`, { shot: "data:image/png;base64,AAAA" })).status).toBe(409);
  });

  it("delivers without the shot when it does not arrive in time", async () => {
    const created = JSON.parse((await post("/pins", { ...pinInput("No shot"), shotLater: true, send: true })).body);
    const started = Date.now();
    const [settled] = await store.settleShots([created], 200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(settled!.shotPending).toBe(true);
    // A browser that could not capture says so, and the pin stops expecting a shot.
    expect((await post(`/pins/${created.id}/before`, { shot: null })).status).toBe(200);
    expect((await store.getPin(created.id))!.shotPending).toBeUndefined();
  });

  it("stops waiting for an after shot when every open tab is on another page", async () => {
    const tab = (): Promise<http.ClientRequest> =>
      new Promise((resolve) => {
        const req = http.get(`${base}/__jrabbit/api/events?t=${review.token}`, (res) => res.once("data", () => resolve(req)));
      });
    const tabs = [await tab(), await tab()];
    const pin = (await store.listPins())[0]!;
    const started = Date.now();
    const shot = review.requestAfterShot(pin, 5000);
    await post(`/pins/${pin.id}/after`, { away: true, tab: "a" });
    await post(`/pins/${pin.id}/after`, { away: true, tab: "a" }); // the same tab, reloaded
    expect(await Promise.race([shot, new Promise((r) => setTimeout(() => r("waiting"), 150))])).toBe("waiting");
    await post(`/pins/${pin.id}/after`, { away: true, tab: "b" });
    expect(await shot).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    for (const t of tabs) t.destroy();
  });
});
