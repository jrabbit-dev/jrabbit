import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import type { Duplex } from "node:stream";
import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
]);

/**
 * Streams HTML through, inserting `snippet` right after the opening <head> tag
 * (or before <body> / at the start when there is no head). Buffers at most 64 KB.
 */
export class HtmlInjector extends Transform {
  private decoder = new StringDecoder("utf8");
  private buffer = "";
  private done = false;

  constructor(private snippet: string) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    if (this.done) return cb(null, chunk);
    this.buffer += this.decoder.write(chunk);
    const out = this.tryInject(false);
    cb(null, out ?? undefined);
  }

  override _flush(cb: TransformCallback): void {
    if (!this.done) {
      this.buffer += this.decoder.end();
      const out = this.tryInject(true);
      return cb(null, out ?? undefined);
    }
    cb();
  }

  private tryInject(final: boolean): string | null {
    const head = /<head(?:\s[^>]*)?>/i.exec(this.buffer);
    let at = -1;
    if (head) at = head.index + head[0].length;
    else {
      const body = /<body[\s>]/i.exec(this.buffer);
      if (body) at = body.index;
      else if (final || this.buffer.length > 65536) at = 0;
    }
    if (at < 0) return null;
    const out = this.buffer.slice(0, at) + this.snippet + this.buffer.slice(at);
    this.buffer = "";
    this.done = true;
    return out;
  }
}

export interface ProxyOptions {
  target: URL;
  /** Origin of the proxy itself, e.g. http://localhost:4100 */
  proxyOrigin: string;
  /** HTML snippet injected into every HTML document. */
  inject: string;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * If `url` points at `origin` (treating localhost, 127.0.0.1 and ::1 as the same host),
 * return it rebased onto `to`. Otherwise null.
 */
export function rebase(url: string, origin: string, to: string): string | null {
  let u: URL;
  let o: URL;
  try {
    u = new URL(url);
    o = new URL(origin);
  } catch {
    return null;
  }
  const sameHost = u.hostname === o.hostname || (LOOPBACK.has(u.hostname) && LOOPBACK.has(o.hostname));
  if (u.protocol !== o.protocol || u.port !== o.port || !sameHost) return null;
  return to + u.pathname + u.search + u.hash;
}

function rewriteRequestHeaders(
  raw: http.IncomingHttpHeaders,
  { target, proxyOrigin }: ProxyOptions,
): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    headers[k] = v;
  }
  headers.host = target.host;
  // Dev servers check Origin against Host (Next.js server actions, dev-origin guards).
  if (typeof headers.origin === "string" && rebase(headers.origin, proxyOrigin, "") !== null) headers.origin = target.origin;
  if (typeof headers.referer === "string") headers.referer = rebase(headers.referer, proxyOrigin, target.origin) ?? headers.referer;
  return headers;
}

/** Forward one HTTP request to the target dev server, injecting the overlay into HTML. */
export function forward(req: http.IncomingMessage, res: http.ServerResponse, opts: ProxyOptions): void {
  const { target, proxyOrigin, inject } = opts;
  const headers = rewriteRequestHeaders(req.headers, opts);
  const wantsHtml = (req.headers.accept ?? "").includes("text/html");
  // We need plain text to inject into HTML documents.
  if (wantsHtml) headers["accept-encoding"] = "identity";

  const client = target.protocol === "https:" ? https : http;
  const upstream = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
      // Local dev servers often use self-signed certificates.
      rejectUnauthorized: false,
    },
    (up) => {
      const out: http.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (v === undefined || HOP_BY_HOP.has(k)) continue;
        out[k] = v;
      }
      if (typeof out.location === "string") out.location = rebase(out.location, target.origin, proxyOrigin) ?? out.location;
      const type = String(up.headers["content-type"] ?? "");
      const encoding = String(up.headers["content-encoding"] ?? "identity");
      const injectable =
        type.includes("text/html") && encoding === "identity" && req.method !== "HEAD" && up.statusCode !== 204;
      if (injectable) {
        delete out["content-length"];
        delete out["transfer-encoding"];
        res.writeHead(up.statusCode ?? 200, up.statusMessage, out);
        up.pipe(new HtmlInjector(inject)).pipe(res);
      } else {
        res.writeHead(up.statusCode ?? 200, up.statusMessage, out);
        up.pipe(res);
      }
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
      res.end(unreachablePage(target, err));
    } else res.destroy(err);
  });
  req.on("aborted", () => upstream.destroy());
  req.pipe(upstream);
}

/** Tunnel a WebSocket upgrade (HMR) to the target dev server. */
export function forwardUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, opts: ProxyOptions): void {
  const { target } = opts;
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const upstream =
    target.protocol === "https:"
      ? tls.connect({ host: target.hostname, port, servername: target.hostname, rejectUnauthorized: false })
      : net.connect({ host: target.hostname, port });

  const onConnect = () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i]!;
      let value = req.rawHeaders[i + 1]!;
      const lower = name.toLowerCase();
      if (lower === "host") value = target.host;
      if (lower === "origin" && rebase(value, opts.proxyOrigin, "") !== null) value = target.origin;
      lines.push(`${name}: ${value}`);
    }
    upstream.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  };
  upstream.once(target.protocol === "https:" ? "secureConnect" : "connect", onConnect);
  const close = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
  upstream.on("close", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function unreachablePage(target: URL, err: Error): string {
  return `<!doctype html><meta charset="utf-8"><title>jrabbit · dev server unreachable</title>
<body style="font:14px/1.5 ui-monospace,Menlo,monospace;background:#0b0b0b;color:#f5f5f5;padding:48px">
<p>jrabbit could not reach <b>${escapeHtml(target.origin)}</b>.</p>
<p style="color:#8a8a8a">${escapeHtml(err.message)}</p>
<p>Start your dev server, then reload this page.</p>
<script>setTimeout(()=>location.reload(),2000)</script></body>`;
}
