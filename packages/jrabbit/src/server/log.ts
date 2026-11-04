/** stdout belongs to the MCP protocol. Everything human-readable goes to stderr. */
export function log(...args: unknown[]): void {
  if (process.env.JRABBIT_QUIET) return;
  process.stderr.write(`[jrabbit] ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")}\n`);
}
