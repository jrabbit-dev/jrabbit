import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { init, mergeCursorConfig, mergeStopHook, packageSpec, removeStopHook, stopDecision, type Run } from "../src/server/setup.js";
import { Store } from "../src/server/store.js";

const project = () => mkdtempSync(join(tmpdir(), "jrabbit-setup-"));

const pinInput = {
  comment: "Tighter",
  page: { url: "http://localhost:4100/", path: "/", title: "t" },
  viewport: { width: 1280, height: 800, dpr: 1 },
  element: { selector: "h1", tag: "h1", text: "Hi", rect: { x: 0, y: 0, width: 10, height: 10 } },
};

async function sentPin(store: Store, delivered = false) {
  const pin = await store.createPin(pinInput, null, []);
  await store.updatePin(pin.id, (p) => {
    store.setStatus(p, "open", "human");
    if (delivered) p.deliveredAt = new Date().toISOString();
  });
  return pin;
}

describe("stopDecision", () => {
  it("lets the agent stop in a project that never used jrabbit", async () => {
    const root = project();
    expect(await stopDecision(new Store(root))).toBeNull();
    expect(existsSync(join(root, ".jrabbit"))).toBe(false);
  });

  it("blocks while a sent pin has not been picked up", async () => {
    const store = new Store(project());
    await sentPin(store);
    expect(await stopDecision(store)).toContain("#1");
  });

  it("keeps the agent waiting while the human has the review open", async () => {
    const store = new Store(project());
    await store.init();
    await store.beat("overlay");
    await store.beat("human");
    expect(await stopDecision(store)).toContain("wait_for_feedback");
  });

  it("lets it stop once the human pressed Done", async () => {
    const store = new Store(project());
    await sentPin(store);
    await store.beat("overlay");
    await store.beat("human");
    await store.setClosed(true);
    expect(await stopDecision(store)).toBeNull();
  });

  it("lets it stop when the review tab is closed or left untouched", async () => {
    const store = new Store(project());
    await store.init();
    await store.beat("human");
    expect(await stopDecision(store)).toBeNull(); // no browser connected
    await store.beat("overlay");
    const old = new Date(Date.now() - 60 * 60_000);
    utimesSync(join(store.dir, ".human"), old, old);
    expect(await stopDecision(store)).toBeNull(); // open but idle for an hour
  });

  it("reminds once about pins the agent received and did not resolve", async () => {
    const store = new Store(project());
    await sentPin(store, true);
    expect(await stopDecision(store)).toContain("not resolved");
    expect(await stopDecision(store, { stop_hook_active: true })).toBeNull();
  });

  it("lets go of an agent that keeps stopping without ever waiting", async () => {
    const store = new Store(project());
    await sentPin(store);
    expect(await stopDecision(store)).toContain("#1");
    expect(await stopDecision(store, { stop_hook_active: true })).toContain("#1");
    expect(await stopDecision(store, { stop_hook_active: true })).toBeNull();
  });

  it("keeps blocking an agent that does go back to waiting", async () => {
    const store = new Store(project());
    await store.init();
    for (let i = 0; i < 4; i++) {
      await store.beat("overlay");
      await store.beat("human");
      expect(await stopDecision(store, { stop_hook_active: true })).toContain("wait_for_feedback");
      await new Promise((r) => setTimeout(r, 15));
      await store.beat("agent"); // it waited for pins before trying to stop again
      await new Promise((r) => setTimeout(r, 15));
    }
  });

  it("leaves sessions that never touched jrabbit alone", async () => {
    const root = project();
    const store = new Store(root);
    await sentPin(store);
    const other = join(root, "other.jsonl");
    writeFileSync(other, '{"text":"fix the migration"}\n');
    const ours = join(root, "ours.jsonl");
    writeFileSync(ours, '{"tool":"mcp__jrabbit__open_review"}\n');
    expect(await stopDecision(store, { transcript_path: other })).toBeNull();
    expect(await stopDecision(store, { transcript_path: ours })).toContain("#1");
  });
});

describe("init", () => {
  it("pins the package version for releases only", () => {
    expect(packageSpec("0.2.0")).toBe("jrabbit@0.2.0");
    expect(packageSpec("dev")).toBe("jrabbit");
  });

  it("adds jrabbit to a Cursor config without touching other servers", () => {
    const config = { mcpServers: { other: { command: "x" } } };
    expect(mergeCursorConfig(config, "jrabbit@0.2.0")).toBe(true);
    expect(Object.keys(config.mcpServers)).toEqual(["other", "jrabbit"]);
    expect(mergeCursorConfig(config, "jrabbit@0.2.0")).toBe(false);
  });

  it("adds the Stop hook once, updates its version, and removes only its own", () => {
    const settings: Record<string, any> = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } };
    expect(mergeStopHook(settings, "jrabbit@0.2.0")).toBe(true);
    expect(mergeStopHook(settings, "jrabbit@0.2.0")).toBe(false);
    expect(mergeStopHook(settings, "jrabbit@0.3.0")).toBe(true);
    const commands = settings.hooks.Stop.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toEqual(["say done", "npx -y jrabbit@0.3.0 hook stop"]);
    expect(removeStopHook(settings)).toBe(true);
    expect(settings.hooks.Stop).toEqual([{ hooks: [{ type: "command", command: "say done" }] }]);
  });

  it("sets up every agent it finds and skips the ones it does not", async () => {
    const root = project();
    mkdirSync(join(root, ".cursor"));
    const calls: string[] = [];
    const run: Run = async (cmd, args) => {
      calls.push([cmd, ...args].join(" "));
      if (cmd === "codex") return { ok: false, out: "not found" };
      return { ok: !(args[0] === "mcp" && args[1] === "get"), out: "" };
    };
    const steps = await init(root, "0.2.0", { run });
    expect(steps.map((s) => [s.client, s.ok])).toEqual([
      ["Claude Code", true],
      ["Cursor", true],
    ]);
    expect(calls).toContain("claude mcp add jrabbit -- npx -y jrabbit@0.2.0");
    const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.local.json"), "utf8"));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe("npx -y jrabbit@0.2.0 hook stop");
    const cursor = JSON.parse(readFileSync(join(root, ".cursor", "mcp.json"), "utf8"));
    expect(cursor.mcpServers.jrabbit.args).toEqual(["-y", "jrabbit@0.2.0"]);
  });

  it("skips the hook when asked, and says why a requested agent is missing", async () => {
    const root = project();
    const run: Run = async (cmd, args) => ({ ok: cmd === "claude" && args[1] !== "get", out: "" });
    const steps = await init(root, "0.2.0", { run, hook: false, only: ["claude", "codex"] });
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
    expect(steps[1]).toMatchObject({ client: "Codex", ok: false });
    expect(steps[1]!.note).toContain("PATH");
  });
});
