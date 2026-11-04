import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { ReviewServer } from "./review.js";
import { runMcp } from "./mcp.js";
import { openBrowser } from "./open-browser.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";

const HELP = `jrabbit ${VERSION}
Point at your UI. Your coding agent fixes it.

Usage
  jrabbit                 Run the MCP server over stdio (what your agent runs)
  jrabbit open <url>      Open a review of <url> without an agent (for testing)
  jrabbit --version
  jrabbit --help

Install
  Claude Code  claude mcp add jrabbit -- npx -y jrabbit
  Codex        codex mcp add jrabbit -- npx -y jrabbit

Environment
  JRABBIT_ROOT       Project root (default: current directory)
  JRABBIT_PORT       Preferred port for the review server (default: 4100)
  JRABBIT_NO_OPEN=1  Do not open the browser
`;

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") return void console.log(VERSION);
  if (cmd === "--help" || cmd === "-h" || cmd === "help") return void console.log(HELP);

  const root = resolve(process.env.JRABBIT_ROOT ?? process.cwd());
  const overlay = join(dirname(fileURLToPath(import.meta.url)), "overlay.js");
  const store = new Store(root);
  const review = new ReviewServer(store, overlay);
  const port = Number(process.env.JRABBIT_PORT ?? 4100);

  if (cmd === "open") {
    const url = args[0];
    if (!url) {
      console.error("Usage: jrabbit open <url>");
      process.exit(1);
    }
    let reviewUrl: string;
    try {
      reviewUrl = await review.start(url, port);
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
    openBrowser(reviewUrl);
    process.on("SIGINT", async () => {
      await review.stop();
      process.exit(0);
    });
    return;
  }

  if (cmd) {
    console.error(`Unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }
  await runMcp(store, review, VERSION);
}

main().catch((err) => {
  process.stderr.write(`[jrabbit] ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
