import { spawn } from "node:child_process";

/** Command that opens a URL in the default browser. No shell: `&` in a URL stays literal. */
export function browserCommand(platform: NodeJS.Platform, url: string): [string, string[]] {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

/** Open a URL in the default browser. Never throws. */
export function openBrowser(url: string): void {
  if (process.env.JRABBIT_NO_OPEN) return;
  const [cmd, args] = browserCommand(process.platform, url);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* the agent still returns the URL */
  }
}
