// Anonymous usage count: one ping a day per machine, so the project knows how many people use it.
// It carries a random id, the jrabbit version, the agent's name and the OS. Nothing about the project.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENDPOINT = "https://jrabbit.dev/api/ping";
const TIMEOUT_MS = 2000;

export const TELEMETRY_NOTICE =
  "jrabbit counts usage with one anonymous ping a day: a random id, the version, your agent and OS. Nothing about your project. Turn it off with JRABBIT_TELEMETRY=0.";

type Env = Record<string, string | undefined>;

/** Off when the user says so, in CI and tests, and in dev builds. */
export function telemetryOff(version: string, env: Env = process.env): boolean {
  if (["0", "false", "off", "no"].includes((env.JRABBIT_TELEMETRY ?? "").toLowerCase())) return true;
  if (env.DO_NOT_TRACK && env.DO_NOT_TRACK !== "0") return true;
  if (env.CI || env.VITEST || env.NODE_ENV === "test") return true;
  return version === "dev";
}

interface PingOptions {
  /** Where the id lives. Default `~/.jrabbit`. */
  dir?: string;
  env?: Env;
  fetch?: typeof fetch;
  now?: Date;
  /** Called the first time, when the id is created. */
  notice?: (text: string) => void;
}

/** Sends today's ping if this machine has not sent one yet. Never throws; a failure is retried next time. */
export async function ping(version: string, client: string | undefined, opts: PingOptions = {}): Promise<"sent" | "skipped"> {
  if (telemetryOff(version, opts.env)) return "skipped";
  try {
    const dir = opts.dir ?? join(homedir(), ".jrabbit");
    const file = join(dir, "telemetry.json");
    let state: { id?: string; day?: string } = {};
    try {
      state = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // first run, or an unreadable file: start over
    }
    const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
    if (state.id && state.day === day) return "skipped";
    if (!state.id) {
      state = { id: randomUUID() };
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(state));
      (opts.notice ?? ((text) => console.error(text)))(TELEMETRY_NOTICE);
    }
    const res = await (opts.fetch ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: state.id, v: version, client: client?.slice(0, 40), os: process.platform }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return "skipped";
    writeFileSync(file, JSON.stringify({ id: state.id, day }));
    return "sent";
  } catch {
    return "skipped";
  }
}
