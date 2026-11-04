import { spawn } from "node:child_process";

/** Open a URL in the default browser. Never throws. */
export function openBrowser(url: string): void {
  if (process.env.JRABBIT_NO_OPEN) return;
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    /* the agent still returns the URL */
  }
}
