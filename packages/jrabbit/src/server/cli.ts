import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { ReviewServer } from "./review.js";
import { formatPin, formatRule, runMcp } from "./mcp.js";
import { openBrowser } from "./open-browser.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

const HELP = `jrabbit ${VERSION}
Your partner for shipping products.

Usage
  jrabbit                        Run the MCP server over stdio (what your agent runs)
  jrabbit open <url>             Open a review of <url> in the browser. Keep it running.
  jrabbit wait [seconds]         Wait for pins the human sends, print them as JSON (default 50 s)
  jrabbit resolve <n> <summary>  Mark pin #n resolved. The open review captures the after shot.
  jrabbit --version
  jrabbit --help

wait and resolve let an agent work from the shell before its MCP tools are loaded.
They share .jrabbit/ with the MCP server, so nothing is lost when the agent restarts.

Install
  Claude Code  claude mcp add jrabbit -- npx -y jrabbit
  Codex        codex mcp add jrabbit -- npx -y jrabbit

Environment
  JRABBIT_ROOT       Project root (default: the client's workspace, else the current directory)
  JRABBIT_PORT       Preferred port for the review server (default: 4100)
  JRABBIT_NO_OPEN=1  Do not open the browser
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") return void console.log(VERSION);
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return void console.log(HELP);

  const root = resolve(process.env.JRABBIT_ROOT ?? process.cwd());
  const store = new Store(root);

  if (cmd === "open") return open(store, args[0]);
  if (cmd === "wait") return wait(store, args[0]);
  if (cmd === "resolve") return resolvePin(store, args[0], args.slice(1).join(" "));
  if (cmd) {
    console.error(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }
  const review = new ReviewServer(store, overlayPath());
  await runMcp(store, review, VERSION, { clientRoots: !process.env.JRABBIT_ROOT });
}

function overlayPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "overlay.js");
}

async function open(store: Store, url: string | undefined): Promise<void> {
  if (!url) {
    console.error("Usage: jrabbit open <url>");
    process.exit(1);
  }
  const review = new ReviewServer(store, overlayPath());
  let reviewUrl: string;
  try {
    reviewUrl = await review.start(url, Number(process.env.JRABBIT_PORT ?? 4100));
  } catch (err) {
    console.error(`jrabbit: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log(`jrabbit reviewing ${url}\n→ ${reviewUrl}\nPins are saved in ${store.dir}. Ctrl+C to stop.`);
  review.on("sent", (pins) => {
    for (const p of pins) {
      const src = p.source ? `${p.source.file}:${p.source.line}` : "source unknown";
      console.log(`#${p.n} ${p.comment}  [${src}]`);
    }
  });

  // Pins resolved by another process (jrabbit resolve, or an MCP session) get their after shot here,
  // where the browser is connected. Pins already resolved before this review started are left alone.
  const captured = new Map<string, string>();
  for (const p of await store.listPins()) if (p.resolution) captured.set(p.id, p.resolution.at);
  let checking: Promise<void> = Promise.resolve();
  review.on("changed", () => {
    checking = checking.then(async () => {
      for (const p of await store.listPins().catch(() => [])) {
        const at = p.resolution?.at;
        if (p.status !== "resolved" || !at || captured.get(p.id) === at) continue;
        captured.set(p.id, at);
        void review.requestAfterShot(p);
      }
    });
  });

  openBrowser(reviewUrl);
  process.on("SIGINT", async () => {
    await review.stop();
    process.exit(0);
  });
}

async function wait(store: Store, secondsArg: string | undefined): Promise<void> {
  const seconds = Math.min(600, Math.max(1, Number(secondsArg ?? 50) || 50));
  const deadline = Date.now() + seconds * 1000;
  await store.init();
  let { pins } = await store.claimUndelivered();
  while (!pins.length && Date.now() < deadline) {
    await store.beat("agent"); // the open review shows "listening"
    await sleep(1000);
    ({ pins } = await store.claimUndelivered());
  }

  if (!pins.length) {
    const drafts = (await store.listPins()).filter((p) => p.status === "draft").length;
    return print({ status: "timeout", drafts, next: "Nothing sent yet. Run jrabbit wait again now. Do not end your turn until the human says they are done." });
  }
  const rules = (await store.listRules()).filter((r) => r.status === "approved");
  print({
    status: "feedback",
    pins: pins.map(formatPin),
    approvedRules: rules.map(formatRule),
    next: "Look at each pin's before screenshot (shots.before, relative to the project root) and edit the code now, without asking the human to confirm. Then run jrabbit resolve <n> \"<what you changed>\" for each pin. Then run jrabbit wait again.",
  });
}

async function resolvePin(store: Store, id: string | undefined, summary: string): Promise<void> {
  if (!id || !summary.trim()) {
    console.error('Usage: jrabbit resolve <n> "<what you changed>"');
    process.exit(1);
  }
  await store.init();
  const found = await store.getPin(id);
  if (!found) {
    console.error(`jrabbit: no pin ${id}`);
    process.exit(1);
  }
  if (found.status === "draft") {
    console.error(`jrabbit: pin #${found.n} is a draft: the human has not sent it yet.`);
    process.exit(1);
  }
  const text = summary.trim();
  const pin = await store.updatePin(found.id, (p) => {
    if (p.status !== "approved") store.setStatus(p, "resolved", "agent", text);
    p.resolution = { summary: text, at: new Date().toISOString() };
  });
  print({
    pin: formatPin(pin ?? found),
    next: "The open review captures the after shot in the browser. The human approves or reopens there. Run jrabbit wait to get the next pins.",
  });
}

main().catch((err) => {
  process.stderr.write(`[jrabbit] ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
