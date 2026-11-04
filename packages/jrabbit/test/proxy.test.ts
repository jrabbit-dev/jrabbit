import net from "node:net";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { HtmlInjector, probe } from "../src/server/proxy.js";

const run = (chunks: string[], snippet = "<X>") => text(Readable.from(chunks.map((c) => Buffer.from(c))).pipe(new HtmlInjector(snippet)));

describe("HtmlInjector", () => {
  it("inserts after <head>", async () => {
    expect(await run(["<!doctype html><html><head><title>a</title></head><body></body></html>"])).toBe(
      "<!doctype html><html><head><X><title>a</title></head><body></body></html>",
    );
  });

  it("handles <head> with attributes split across chunks", async () => {
    expect(await run(["<html><he", 'ad lang="en">', "<meta>"])).toBe('<html><head lang="en"><X><meta>');
  });

  it("does not match <header>", async () => {
    expect(await run(["<body><header>hi</header>"])).toBe("<X><body><header>hi</header>");
  });

  it("falls back to the start when there is no head or body", async () => {
    expect(await run(["<div>fragment</div>"])).toBe("<X><div>fragment</div>");
  });

  it("injects once", async () => {
    expect(await run(["<head>", "<head>"])).toBe("<head><X><head>");
  });

  it("keeps multi-byte characters split across chunks", async () => {
    const buf = Buffer.from("<head>ñandú");
    const out = await text(Readable.from([buf.subarray(0, 8), buf.subarray(8)]).pipe(new HtmlInjector("<X>")));
    expect(out).toBe("<head><X>ñandú");
  });
});

describe("rebase", () => {
  it("treats loopback names as the same host", async () => {
    const { rebase } = await import("../src/server/proxy.js");
    expect(rebase("http://127.0.0.1:3000/a?b#c", "http://localhost:3000", "http://localhost:4100")).toBe("http://localhost:4100/a?b#c");
    expect(rebase("http://localhost:3001/a", "http://localhost:3000", "X")).toBeNull();
    expect(rebase("https://evil.example/a", "http://localhost:3000", "X")).toBeNull();
    expect(rebase("/relative", "http://localhost:3000", "X")).toBeNull();
  });
});

describe("hostOnlyCookies", () => {
  it("drops Domain so cookies stay on the review host", async () => {
    const { hostOnlyCookies } = await import("../src/server/proxy.js");
    expect(hostOnlyCookies(["sid=1; Path=/; Domain=localhost; HttpOnly", "a=2; domain=.example.com", "b=3"])).toEqual([
      "sid=1; Path=/; HttpOnly",
      "a=2",
      "b=3",
    ]);
  });
});

describe("browserCommand", () => {
  it("never goes through a shell, so & in a URL stays literal", async () => {
    const { browserCommand } = await import("../src/server/open-browser.js");
    const url = "http://localhost:4100/?a=1&b=2";
    expect(browserCommand("darwin", url)).toEqual(["open", [url]]);
    expect(browserCommand("win32", url)).toEqual(["rundll32", ["url.dll,FileProtocolHandler", url]]);
    expect(browserCommand("linux", url)).toEqual(["xdg-open", [url]]);
  });
});

describe("probe", () => {
  it("returns null when something listens and a reason when nothing does", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as net.AddressInfo;
    expect(await probe(new URL(`http://127.0.0.1:${port}/`))).toBeNull();
    await new Promise((r) => server.close(r));
    expect(await probe(new URL(`http://127.0.0.1:${port}/`))).toBe("ECONNREFUSED");
  });
});
