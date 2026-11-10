import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { LOOPBACK, rebase } from "../shared/url.js";
import { forward, forwardUpgrade, probe, type ProxyOptions } from "./proxy.js";
import { SourceResolver, type RawFrame } from "./source.js";
import type { Store } from "./store.js";
import type { AgentState, NewPinInput, OverlayState, Pin, ServerEvent } from "../shared/types.js";
import { log } from "./log.js";

const MAX_BODY = 25 * 1024 * 1024;
const PREFIX = "/__jrabbit";

export interface ReviewEvents {
  /** The human pressed Send, or reopened a pin with a note. */
  sent: [Pin[]];
  /** Pins or rules changed, in this process or another one on the same project. */
  changed: [];
}

/**
 * The local review server: reverse proxy to the dev server with the overlay
 * injected, plus the overlay's API under /__jrabbit. Binds to loopback only.
 */
export class ReviewServer extends EventEmitter<ReviewEvents> {
  /** Set by start(); shared by every jrabbit process on the project (see Store.token). */
  token = "";
  agent: AgentState = "none";
  private servers: http.Server[] = [];
  private watchers: FSWatcher[] = [];
  private watchTimer: NodeJS.Timeout | null = null;
  private agentTimer: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  /** An agent in another jrabbit process (MCP session or `jrabbit wait`) is waiting for pins. */
  private elsewhere: AgentState = "none";
  /** Last closed state the overlays were told about: `jrabbit close` runs in another process. */
  private closedSeen = false;
  private clients = new Set<http.ServerResponse>();
  private pendingAfter = new Map<string, { selector: string; text: string; path: string; done: (pin: Pin | null) => void }>();
  private resolver: SourceResolver;
  target: URL | null = null;
  port: number | null = null;

  constructor(
    private store: Store,
    private overlayFile: string,
  ) {
    super();
    this.resolver = new SourceResolver(
      () => store.root,
      (url) => this.fetchFromTarget(url),
      (frame) => this.nextOriginalFrame(frame),
    );
  }

  /**
   * Same host name as the dev server when it is on loopback. Cookies ignore the port, so the
   * review and the dev server share the login session: signing in on either works on both
   * (OAuth callbacks usually land on the dev server URL).
   */
  get origin(): string | null {
    if (!this.port) return null;
    const host = this.target && LOOPBACK.has(this.target.hostname) ? this.target.hostname : "localhost";
    return `http://${host}:${this.port}`;
  }

  get connectedClients(): number {
    return this.clients.size;
  }

  /** Start (or retarget) the review. Returns the URL to open in the browser. */
  async start(targetUrl: string, preferredPort = 4100): Promise<string> {
    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      throw new Error(`"${targetUrl}" is not a URL. Pass the dev server URL, e.g. http://localhost:3000`);
    }
    if (!/^https?:$/.test(target.protocol)) throw new Error("Only http(s) URLs can be reviewed");
    await this.checkTarget(target);
    await this.store.init();
    this.token ||= await this.store.token();
    this.target = target;
    await this.store.setClosed(false);
    await this.store.beat("human");
    if (!this.port) {
      this.port = await this.listen(preferredPort);
      this.watchStore();
      this.presenceTimer = setInterval(() => void this.syncPresence(), 1000);
      this.presenceTimer.unref();
    }
    this.broadcastState();
    return this.origin! + (target.pathname === "/" ? "" : target.pathname) + target.search;
  }

  /** Fail early, with a message the agent can act on, instead of proxying to nothing. */
  private async checkTarget(target: URL): Promise<void> {
    const loopback = LOOPBACK.has(target.hostname);
    if (loopback && this.port && Number(target.port) === this.port) {
      throw new Error(`${target.origin} is this jrabbit review itself. Pass the dev server URL instead.`);
    }
    const reason = await probe(target);
    if (reason) {
      throw new Error(
        `Nothing is answering at ${target.origin} (${reason}). Start the dev server (e.g. npm run dev), check its port, then try again.`,
      );
    }
    // Reviewing another jrabbit review would stack two overlays.
    const res = await fetch(new URL(`${PREFIX}/overlay.js`, target), { method: "HEAD", signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (res?.ok && (res.headers.get("content-type") ?? "").includes("javascript")) {
      throw new Error(`${target.origin} is a jrabbit review, not a dev server. Pass the URL of the app it reviews.`);
    }
  }

  /** Pick up changes made by other jrabbit processes on the same store. */
  private watchStore(): void {
    const changed = () => {
      if (this.watchTimer) clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => this.broadcastState(), 150);
    };
    for (const sub of ["pins", "rules"]) {
      try {
        this.watchers.push(watch(join(this.store.dir, sub), changed));
      } catch (err) {
        log(`cannot watch ${sub}`, err);
      }
    }
  }

  /** Share presence with other jrabbit processes on the same store, through heartbeat files. */
  private async syncPresence(): Promise<void> {
    if (this.clients.size) await this.store.beat("overlay");
    const closed = this.store.isClosed();
    if (closed !== this.closedSeen) this.broadcastState();
    const listening = await this.store.fresh("agent");
    const next: AgentState = listening ? "listening" : this.elsewhere === "none" ? "none" : "connected";
    if (next !== this.elsewhere) {
      const before = this.agentState;
      this.elsewhere = next;
      if (this.agentState !== before) this.broadcastState();
    }
  }

  /** What the overlay shows: the most engaged agent, here or in another process. */
  get agentState(): AgentState {
    const rank = { none: 0, connected: 1, listening: 2 } as const;
    return rank[this.elsewhere] > rank[this.agent] ? this.elsewhere : this.agent;
  }

  /** A browser is connected to this review, or to another jrabbit review of this project. */
  async overlayConnected(): Promise<boolean> {
    return this.clients.size > 0 || (await this.store.fresh("overlay"));
  }

  /**
   * The agent calls wait_for_feedback in a loop, leaving short gaps between calls.
   * Going from "listening" to anything else is delayed so the overlay does not flicker.
   */
  setAgent(agent: AgentState): void {
    if (this.agentTimer) clearTimeout(this.agentTimer);
    this.agentTimer = null;
    const apply = () => {
      if (this.agent === agent) return;
      this.agent = agent;
      if (this.port) this.broadcastState();
    };
    if (this.agent === "listening" && agent !== "listening") {
      this.agentTimer = setTimeout(apply, 1500);
      this.agentTimer.unref();
    } else apply();
  }

  async stop(): Promise<void> {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.agentTimer) clearTimeout(this.agentTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
    for (const c of this.clients) c.end();
    await Promise.all(this.servers.map((s) => new Promise((r) => s.close(r))));
    this.servers = [];
    this.port = null;
  }

  private async listen(preferred: number): Promise<number> {
    for (let port = preferred; port < preferred + 50; port++) {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
      const ok = await new Promise<boolean>((done) => {
        server.once("error", () => done(false));
        server.listen(port, "127.0.0.1", () => done(true));
      });
      if (!ok) continue;
      this.servers.push(server);
      // Also answer on IPv6 loopback so `localhost` works everywhere. Best effort.
      const v6 = http.createServer((req, res) => this.handle(req, res));
      v6.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
      await new Promise<void>((done) => {
        v6.once("error", () => done());
        v6.listen(port, "::1", () => {
          this.servers.push(v6);
          done();
        });
      });
      return port;
    }
    throw new Error(`No free port between ${preferred} and ${preferred + 49}`);
  }

  private proxyOptions(): ProxyOptions {
    return {
      target: this.target!,
      proxyOrigin: this.origin!,
      inject: `<script src="${PREFIX}/overlay.js?t=${this.token}" data-jrabbit async></script>`,
    };
  }

  /** Reject requests whose Host is not our loopback origin (DNS rebinding). */
  private hostAllowed(req: http.IncomingMessage): boolean {
    const host = req.headers.host ?? "";
    return [`localhost:${this.port}`, `127.0.0.1:${this.port}`, `[::1]:${this.port}`].includes(host);
  }

  private authorized(req: http.IncomingMessage, url: URL): boolean {
    if (!this.token) return false;
    const given = String(req.headers["x-jrabbit-token"] ?? url.searchParams.get("t") ?? "");
    const a = Buffer.from(given);
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private handleUpgrade(req: http.IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    if (!this.hostAllowed(req) || !this.target || (req.url ?? "").startsWith(PREFIX)) {
      socket.destroy();
      return;
    }
    forwardUpgrade(req, socket, head, this.proxyOptions());
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.hostAllowed(req)) {
      res.writeHead(403).end("Forbidden host");
      return;
    }
    const url = new URL(req.url ?? "/", this.origin!);
    if (url.pathname.startsWith(PREFIX + "/")) {
      this.handleInternal(req, res, url).catch((err: Error) => {
        log("internal error", err);
        if (!res.headersSent) json(res, 500, { error: err.message });
        else res.end();
      });
      return;
    }
    if (!this.target) {
      res.writeHead(503).end("No review open");
      return;
    }
    forward(req, res, this.proxyOptions());
  }

  private async handleInternal(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const path = url.pathname.slice(PREFIX.length);

    if (path === "/overlay.js" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      createReadStream(this.overlayFile).pipe(res);
      return;
    }

    if (!this.authorized(req, url)) return json(res, 401, { error: "unauthorized" });

    if (path === "/api/ping" && req.method === "GET") return json(res, 200, { ok: true });

    if (path.startsWith("/shots/") && req.method === "GET") {
      const file = this.store.shotFile(`.jrabbit/shots/${path.slice("/shots/".length)}`);
      if (!file || !existsSync(file)) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      createReadStream(file).pipe(res);
      return;
    }

    if (path === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      res.write(": hi\n\n");
      this.clients.add(res);
      void this.store.beat("human");
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => {
        clearInterval(ping);
        this.clients.delete(res);
      });
      this.send(res, { type: "state", state: await this.state() });
      for (const [id, p] of this.pendingAfter) this.send(res, { type: "capture-after", id, selector: p.selector, text: p.text, path: p.path });
      return;
    }

    if (req.method !== "POST" && req.method !== "DELETE") return json(res, 405, { error: "method not allowed" });
    // Same-origin JSON only: blocks form-based CSRF from other pages.
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
      return json(res, 415, { error: "json only" });
    }
    const origin = req.headers.origin;
    if (origin && rebase(origin, this.origin!, "") === null) {
      return json(res, 403, { error: "bad origin" });
    }
    const body = await readJson(req);
    // Anything the human does in the review counts as activity: agents keep waiting for them.
    if (path !== "/api/done" && !path.endsWith("/after")) void this.store.beat("human");

    if (path === "/api/pins" && req.method === "POST") {
      const input = body as NewPinInput;
      if (!input?.comment?.trim()) return json(res, 400, { error: "comment required" });
      if (!input.element?.selector || !input.element.rect) return json(res, 400, { error: "element required" });
      const { source, chain } = await this.resolver.resolve(input.debug ?? []);
      const { debug: _d, shot, send, ...rest } = input;
      const pin = await this.store.createPin(rest, source, chain, shot);
      if (send) {
        const sent = await this.sendDrafts();
        return json(res, 200, sent.find((p) => p.id === pin.id) ?? pin);
      }
      this.broadcastState();
      return json(res, 200, pin);
    }

    if (path === "/api/done" && req.method === "POST") {
      await this.close();
      return json(res, 200, { closed: true });
    }

    if (path === "/api/approve-all" && req.method === "POST") {
      const resolved = (await this.store.listPins()).filter((p) => p.status === "resolved");
      for (const r of resolved) {
        await this.store.updatePin(r.id, (p) => {
          if (p.status === "resolved") this.store.setStatus(p, "approved", "human");
        });
      }
      this.broadcastState();
      return json(res, 200, { approved: resolved.length });
    }

    if (path === "/api/send" && req.method === "POST") {
      const sent = await this.sendDrafts();
      return json(res, 200, { sent: sent.length });
    }

    const pinAction = /^\/api\/pins\/([\w-]+)(?:\/(approve|reopen|after))?$/.exec(path);
    if (pinAction) {
      const [, id, action] = pinAction;
      if (req.method === "DELETE" && !action) {
        const ok = await this.store.deletePin(id!);
        this.broadcastState();
        return json(res, ok ? 200 : 409, { deleted: ok });
      }
      if (action === "approve") {
        const pin = await this.store.updatePin(id!, (p) => {
          if (p.status === "resolved") this.store.setStatus(p, "approved", "human");
        });
        this.broadcastState();
        return json(res, pin ? 200 : 404, pin ?? { error: "not found" });
      }
      if (action === "reopen") {
        const note = typeof body?.note === "string" ? body.note.trim() : "";
        const pin = await this.store.updatePin(id!, (p) => {
          if (p.status === "draft") return;
          this.store.setStatus(p, "open", "human", note || undefined);
          delete p.deliveredAt;
          p.sentAt = new Date().toISOString();
        });
        if (pin) await this.store.setClosed(false);
        this.broadcastState();
        if (pin) this.emit("sent", [pin]);
        return json(res, pin ? 200 : 404, pin ?? { error: "not found" });
      }
      if (action === "after") {
        const pending = this.pendingAfter.get(id!);
        let pin: Pin | null = null;
        if (typeof body?.shot === "string") {
          const rel = await this.store.saveShot(id!, "after", body.shot);
          pin = await this.store.updatePin(id!, (p) => {
            p.shots.after = rel;
          });
        }
        if (pending) {
          this.pendingAfter.delete(id!);
          pending.done(pin ?? (await this.store.getPin(id!)));
        }
        this.broadcastState();
        return json(res, 200, { ok: true });
      }
    }

    const ruleAction = /^\/api\/rules\/([a-z0-9-]+)\/approve$/.exec(path);
    if (ruleAction && req.method === "POST") {
      const rule = await this.store.setRuleStatus(ruleAction[1]!, "approved");
      this.broadcastState();
      return json(res, rule ? 200 : 404, rule ?? { error: "not found" });
    }

    const ruleDelete = /^\/api\/rules\/([a-z0-9-]+)$/.exec(path);
    if (ruleDelete && req.method === "DELETE") {
      const ok = await this.store.deleteRule(ruleDelete[1]!);
      this.broadcastState();
      return json(res, ok ? 200 : 404, ok ? { ok } : { error: "not found" });
    }

    if (path === "/api/archive" && req.method === "POST") {
      const archived = await this.store.archivePins();
      this.broadcastState();
      return json(res, 200, { archived: archived.length });
    }

    json(res, 404, { error: "not found" });
  }

  /** End the review: agents stop waiting. Opening it again or sending a pin undoes it. */
  async close(): Promise<void> {
    await this.store.setClosed(true);
    this.broadcastState();
  }

  async sendDrafts(): Promise<Pin[]> {
    const drafts = (await this.store.listPins()).filter((p) => p.status === "draft");
    const sent: Pin[] = [];
    for (const d of drafts) {
      const pin = await this.store.updatePin(d.id, (p) => {
        this.store.setStatus(p, "open", "human");
        p.sentAt = new Date().toISOString();
      });
      if (pin) sent.push(pin);
    }
    if (sent.length) await this.store.setClosed(false);
    this.broadcastState();
    if (sent.length) this.emit("sent", sent);
    return sent;
  }

  /**
   * Ask connected overlays to capture the element again (after the agent's change).
   * Resolves with the updated pin, or null when no overlay answers in time.
   */
  requestAfterShot(pin: Pin, timeoutMs = 15000): Promise<Pin | null> {
    if (this.clients.size === 0) return Promise.resolve(null);
    this.pendingAfter.get(pin.id)?.done(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAfter.delete(pin.id);
        resolve(null);
      }, timeoutMs);
      const entry = {
        selector: pin.element.selector,
        text: pin.element.text,
        path: pin.page.path,
        done: (p: Pin | null) => {
          clearTimeout(timer);
          resolve(p);
        },
      };
      this.pendingAfter.set(pin.id, entry);
      this.broadcast({ type: "capture-after", id: pin.id, selector: entry.selector, text: entry.text, path: entry.path });
    });
  }

  async state(): Promise<OverlayState> {
    return {
      pins: await this.store.listPins(),
      rules: await this.store.listRules(),
      target: this.target?.origin ?? null,
      agent: this.agentState,
      closed: (this.closedSeen = this.store.isClosed()),
    };
  }

  broadcastState(): void {
    this.state()
      .then((state) => this.broadcast({ type: "state", state }))
      .catch((err) => log("state error", err));
    this.emit("changed");
  }

  toast(message: string): void {
    this.broadcast({ type: "toast", message });
  }

  private broadcast(event: ServerEvent): void {
    for (const c of this.clients) this.send(c, event);
  }

  private send(res: http.ServerResponse, event: ServerEvent): void {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  /** Fetch a URL the browser saw (on our origin) from the real dev server. */
  /**
   * Next.js with webpack bundles with eval source maps. Its dev server maps those frames
   * for its own error overlay; ask it the same way. Null on any other dev server.
   */
  private async nextOriginalFrame(frame: RawFrame): Promise<{ file: string; line: number; column?: number } | null> {
    if (!this.target) return null;
    const res = await fetch(new URL("/__nextjs_original-stack-frames", this.target), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        frames: [
          // Next 16 reads line1/column1, Next 14-15 lineNumber/column.
          { file: frame.url, methodName: frame.fn ?? "", arguments: [], line1: frame.line, column1: frame.column, lineNumber: frame.line, column: frame.column },
        ],
        isServer: false,
        isEdgeServer: false,
        isAppDirectory: true,
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const [result] = (await res.json()) as Array<{ status: string; value?: { originalStackFrame?: Record<string, unknown> | null } }>;
    const f = result?.status === "fulfilled" ? result.value?.originalStackFrame : null;
    const line = Number(f?.line1 ?? f?.lineNumber);
    if (typeof f?.file !== "string" || !line) return null;
    const column = Number(f.column1 ?? f.column) || undefined;
    return { file: f.file, line, ...(column ? { column } : {}) };
  }

  private async fetchFromTarget(url: string): Promise<{ body: string; sourceMapHeader?: string } | null> {
    if (!this.target) return null;
    const u = new URL(url);
    const ours = this.port && LOOPBACK.has(u.hostname) && Number(u.port) === this.port;
    const sameAsTarget = u.origin === this.target.origin;
    if (!ours && !sameAsTarget) return null; // never fetch arbitrary hosts
    const real = new URL(u.pathname + u.search, this.target);
    const res = await fetch(real, { headers: { accept: "*/*" } });
    if (!res.ok) return null;
    const header = res.headers.get("sourcemap") ?? res.headers.get("x-sourcemap") ?? undefined;
    return { body: await res.text(), ...(header ? { sourceMapHeader: header } : {}) };
  }
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("Body too large");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function readOverlay(file: string): Promise<string> {
  return readFile(file, "utf8");
}
