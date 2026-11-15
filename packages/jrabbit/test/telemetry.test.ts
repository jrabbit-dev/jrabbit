import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ping, telemetryOff } from "../src/server/telemetry.js";

const tmp = () => mkdtempSync(join(tmpdir(), "jrabbit-telemetry-"));
const ok = () => {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return new Response(null, { status: 204 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};

describe("telemetry", () => {
  it("is off when asked, in CI, in tests and in dev builds", () => {
    expect(telemetryOff("0.3.0", {})).toBe(false);
    expect(telemetryOff("0.3.0", { JRABBIT_TELEMETRY: "0" })).toBe(true);
    expect(telemetryOff("0.3.0", { JRABBIT_TELEMETRY: "off" })).toBe(true);
    expect(telemetryOff("0.3.0", { DO_NOT_TRACK: "1" })).toBe(true);
    expect(telemetryOff("0.3.0", { CI: "true" })).toBe(true);
    expect(telemetryOff("0.3.0", { VITEST: "true" })).toBe(true);
    expect(telemetryOff("dev", {})).toBe(true);
  });

  it("sends one ping a day with a random id and nothing about the project", async () => {
    const dir = tmp();
    const { calls, fetch } = ok();
    const notices: string[] = [];
    const opts = { dir, env: {}, fetch, notice: (t: string) => notices.push(t) };

    expect(await ping("0.3.0", "claude-code", { ...opts, now: new Date("2026-11-15T10:00:00Z") })).toBe("sent");
    expect(await ping("0.3.0", "claude-code", { ...opts, now: new Date("2026-11-15T22:00:00Z") })).toBe("skipped");
    expect(await ping("0.3.0", "claude-code", { ...opts, now: new Date("2026-11-16T01:00:00Z") })).toBe("sent");

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://jrabbit.dev/api/ping");
    expect(Object.keys(calls[0]!.body).sort()).toEqual(["client", "id", "os", "v"]);
    expect(calls[0]!.body).toMatchObject({ v: "0.3.0", client: "claude-code", os: process.platform });
    expect(calls[0]!.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]!.body.id).toBe(calls[0]!.body.id);
    expect(notices).toHaveLength(1); // only when the id is created
    expect(JSON.parse(readFileSync(join(dir, "telemetry.json"), "utf8")).day).toBe("2026-11-16");
  });

  it("never sends what a tampered file holds: it starts a fresh id", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "telemetry.json"), JSON.stringify({ id: "/Users/someone/secret-project", day: "2026-11-14" }));
    const { calls, fetch } = ok();
    expect(await ping("0.3.0", "codex", { dir, env: {}, fetch, notice: () => {} })).toBe("sent");
    expect(calls[0]!.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("sends nothing when turned off", async () => {
    const { calls, fetch } = ok();
    expect(await ping("0.3.0", "codex", { dir: tmp(), env: { JRABBIT_TELEMETRY: "0" }, fetch })).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("never throws, and tries again after a failure", async () => {
    const dir = tmp();
    const now = new Date("2026-11-15T10:00:00Z");
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    expect(await ping("0.3.0", "codex", { dir, env: {}, fetch: down, now, notice: () => {} })).toBe("skipped");
    const { calls, fetch } = ok();
    expect(await ping("0.3.0", "codex", { dir, env: {}, fetch, now, notice: () => {} })).toBe("sent");
    expect(calls).toHaveLength(1);
  });
});
