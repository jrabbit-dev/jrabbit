import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Store } from "./store.js";

/** With the review open but untouched for this long, the agent may end its turn. */
export const IDLE_MS = 30 * 60_000;

// ---------- Stop hook: the agent does not leave while the human is still reviewing ----------

/** What Claude Code and Codex pass to a Stop hook on stdin. Every field is optional for us. */
export interface StopInput {
  /** True when the agent is already continuing because a Stop hook blocked it. */
  stop_hook_active?: boolean;
  transcript_path?: string;
  cwd?: string;
}

/** A session that never touched jrabbit is doing other work in the same project: leave it alone. */
async function sessionUsesJrabbit(transcript: string | undefined): Promise<boolean> {
  if (!transcript) return true;
  // One handle for the size check and the read, so both look at the same file.
  const handle = await open(transcript, "r").catch(() => null);
  if (!handle) return true;
  try {
    const { size } = await handle.stat();
    if (size > 64 * 1024 * 1024) return true;
    return (await handle.readFile("utf8")).includes("jrabbit");
  } catch {
    return true;
  } finally {
    await handle.close();
  }
}

/**
 * Called when the agent is about to end its turn. Returns why it should keep going, or null
 * to let it stop. jrabbit cannot wake an agent once its turn ends, so this is what keeps a
 * sent pin from waiting on the human to ask again.
 */
export async function stopDecision(store: Store, input: StopInput = {}, idleMs = IDLE_MS): Promise<string | null> {
  if (!existsSync(store.dir) || store.isClosed()) return null;
  const open = (await store.listPins()).filter((p) => p.status === "open");
  const unseen = open.filter((p) => !p.deliveredAt);
  const working = open.filter((p) => p.deliveredAt);
  const quiet = await store.age("human");
  const reviewing = (await store.fresh("overlay")) && quiet !== null && quiet < idleMs;
  // Pins it already has: remind once. If it stops again, it had a reason and said so.
  const nudge = working.length > 0 && !input.stop_hook_active;
  if (!unseen.length && !reviewing && !nudge) return null;
  if (!(await sessionUsesJrabbit(input.transcript_path))) return null;
  if (await givingUp(store, input)) return null;

  const list = (pins: typeof open) => pins.map((p) => `#${p.n}`).join(" ");
  if (unseen.length) {
    return `jrabbit: the human sent ${unseen.length === 1 ? "pin" : "pins"} ${list(unseen)} and is waiting. Call wait_for_feedback now (without the MCP tools: npx -y jrabbit wait), change the code, and resolve each pin. Do not ask them to confirm.`;
  }
  if (nudge) {
    return `jrabbit: ${working.length === 1 ? "pin" : "pins"} ${list(working)} ${working.length === 1 ? "is" : "are"} not resolved yet. Change the code and call resolve_feedback, or tell the human why you cannot.${reviewing ? " Then call wait_for_feedback again." : ""}`;
  }
  return "jrabbit: the review is still open in the human's browser, so do not end your turn. Call wait_for_feedback again. It ends when the human presses Done in the review, or tells you they are done and you call close_review (without the MCP tools: npx -y jrabbit close).";
}

/** Blocks in a row after which an agent that never went back to waiting is let go. */
const MAX_IGNORED = 2;

/**
 * An agent that cannot wait (no tools, no permission) would be blocked forever. Count the
 * blocks it answered without waiting for pins in between, and let it stop after a few.
 */
async function givingUp(store: Store, input: StopInput): Promise<boolean> {
  // The file holds when the last block happened and how many were ignored in a row.
  const file = join(store.dir, ".hook");
  let last: { at: number; ignored: number } | null = null;
  try {
    last = JSON.parse(await readFile(file, "utf8")) as { at: number; ignored: number };
  } catch {
    /* first block, or an unreadable file: start counting again */
  }
  const sinceWait = await store.age("agent");
  const waitedSince = !last || (sinceWait !== null && Date.now() - sinceWait > last.at);
  const ignored = input.stop_hook_active && !waitedSince ? (Number(last?.ignored) || 0) + 1 : 0;
  const giveUp = ignored >= MAX_IGNORED;
  await writeFile(file, JSON.stringify({ at: Date.now(), ignored: giveUp ? 0 : ignored })).catch(() => undefined);
  return giveUp;
}

// ---------- init: one command to set jrabbit up for every agent on this machine ----------

export interface Ran {
  ok: boolean;
  out: string;
}
export type Run = (cmd: string, args: string[], cwd: string) => Promise<Ran>;

const run: Run = (cmd, args, cwd) =>
  new Promise((done) => {
    execFile(cmd, args, { cwd, timeout: 30_000, shell: process.platform === "win32" }, (err, stdout, stderr) =>
      done({ ok: !err, out: `${stdout}${stderr}`.trim() }),
    );
  });

export interface InitOptions {
  /** Limit the setup to these clients. Default: every one found. */
  only?: Array<"claude" | "codex" | "cursor">;
  /** Skip the Stop hook (Claude Code and Codex). */
  hook?: boolean;
  run?: Run;
}

export interface InitStep {
  client: "Claude Code" | "Codex" | "Cursor";
  ok: boolean;
  note: string;
}

/** `jrabbit@0.2.0` for a release, `jrabbit` for a dev build. */
export const packageSpec = (version: string) => (/^\d+\.\d+\.\d+/.test(version) ? `jrabbit@${version}` : "jrabbit");

async function readJson(file: string): Promise<Record<string, any>> {
  const text = (
    await readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return "";
      throw err;
    })
  ).trim();
  if (!text) return {};
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not a JSON object");
  return data;
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2) + "\n");
}

/** Add jrabbit to a Cursor mcp.json, keeping every other server. Returns false when nothing changed. */
export function mergeCursorConfig(config: Record<string, any>, spec: string): boolean {
  const entry = { command: "npx", args: ["-y", spec], env: { JRABBIT_ROOT: "${workspaceFolder}" } };
  config.mcpServers ??= {};
  if (JSON.stringify(config.mcpServers.jrabbit) === JSON.stringify(entry)) return false;
  config.mcpServers.jrabbit = entry;
  return true;
}

/** Add (or update) the jrabbit Stop hook in Claude Code settings or Codex hooks.json, keeping every other hook. */
export function mergeStopHook(settings: Record<string, any>, spec: string): boolean {
  const command = `npx -y ${spec} hook stop`;
  settings.hooks ??= {};
  const groups: Array<{ hooks?: Array<{ type?: string; command?: string; timeout?: number }> }> = (settings.hooks.Stop ??= []);
  for (const group of groups) {
    for (const hook of group.hooks ?? []) {
      if (!/\bjrabbit(@\S+)? hook stop\b/.test(hook.command ?? "")) continue;
      if (hook.command === command) return false;
      hook.command = command;
      return true;
    }
  }
  groups.push({ hooks: [{ type: "command", command, timeout: 20 }] });
  return true;
}

/** Remove the jrabbit Stop hook. Returns false when there was none. */
export function removeStopHook(settings: Record<string, any>): boolean {
  const groups: Array<{ hooks?: Array<{ command?: string }> }> | undefined = settings.hooks?.Stop;
  if (!Array.isArray(groups)) return false;
  let removed = false;
  for (const group of groups) {
    const kept = (group.hooks ?? []).filter((h) => !/\bjrabbit(@\S+)? hook stop\b/.test(h.command ?? ""));
    if (kept.length !== (group.hooks ?? []).length) removed = true;
    group.hooks = kept;
  }
  settings.hooks.Stop = groups.filter((g) => g.hooks?.length);
  if (!settings.hooks.Stop.length) delete settings.hooks.Stop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return removed;
}

async function viaCli(bin: "claude" | "codex", spec: string, root: string, exec: Run): Promise<{ ok: boolean; note: string }> {
  if ((await exec(bin, ["mcp", "get", "jrabbit"], root)).ok) return { ok: true, note: "already set up" };
  const added = await exec(bin, ["mcp", "add", "jrabbit", "--", "npx", "-y", spec], root);
  return added.ok
    ? { ok: true, note: "MCP server added" }
    : { ok: false, note: `could not add it: ${added.out.split("\n")[0] || "unknown error"}. Run: ${bin} mcp add jrabbit -- npx -y ${spec}` };
}

/**
 * Set jrabbit up for every agent found: Claude Code and Codex through their own CLI, Cursor
 * through .cursor/mcp.json. Only MCP config (and one Stop hook each for Claude Code and Codex) is written, never code.
 */
export async function init(root: string, version: string, options: InitOptions = {}): Promise<InitStep[]> {
  const exec = options.run ?? run;
  const spec = packageSpec(version);
  const wants = (c: "claude" | "codex" | "cursor") => !options.only?.length || options.only.includes(c);
  const asked = (c: "claude" | "codex" | "cursor") => options.only?.includes(c) ?? false;
  const steps: InitStep[] = [];

  if (wants("claude")) {
    const has = (await exec("claude", ["--version"], root)).ok;
    if (has) {
      const mcp = await viaCli("claude", spec, root, exec);
      let note = mcp.note;
      if (mcp.ok && options.hook !== false) {
        const file = join(root, ".claude", "settings.local.json");
        try {
          const settings = await readJson(file);
          if (mergeStopHook(settings, spec)) await writeJson(file, settings);
          note += " · stays in the review until you press Done";
        } catch (err) {
          note += ` · could not add the Stop hook to .claude/settings.local.json (${(err as Error).message})`;
        }
      }
      steps.push({ client: "Claude Code", ok: mcp.ok, note });
    } else if (asked("claude")) {
      steps.push({ client: "Claude Code", ok: false, note: "the claude command is not on your PATH" });
    }
  }

  if (wants("codex")) {
    const has = (await exec("codex", ["--version"], root)).ok;
    if (has) {
      const mcp = await viaCli("codex", spec, root, exec);
      let note = mcp.note;
      if (mcp.ok && options.hook !== false) {
        // Codex reads the same Stop hook shape as Claude Code, from .codex/hooks.json.
        const file = join(root, ".codex", "hooks.json");
        try {
          const hooks = await readJson(file);
          if (mergeStopHook(hooks, spec)) await writeJson(file, hooks);
          note += " · stays in the review until you press Done (type /hooks in Codex once to trust the hook)";
        } catch (err) {
          note += ` · could not add the Stop hook to .codex/hooks.json (${(err as Error).message})`;
        }
      }
      steps.push({ client: "Codex", ok: mcp.ok, note });
    }
    else if (asked("codex")) steps.push({ client: "Codex", ok: false, note: "the codex command is not on your PATH" });
  }

  if (wants("cursor") && (asked("cursor") || existsSync(join(root, ".cursor")))) {
    const file = join(root, ".cursor", "mcp.json");
    try {
      const config = await readJson(file);
      const changed = mergeCursorConfig(config, spec);
      if (changed) await writeJson(file, config);
      steps.push({ client: "Cursor", ok: true, note: changed ? "added to .cursor/mcp.json" : "already set up" });
    } catch (err) {
      steps.push({ client: "Cursor", ok: false, note: `could not read .cursor/mcp.json (${(err as Error).message})` });
    }
  }

  return steps;
}
