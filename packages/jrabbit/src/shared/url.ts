/** Host names that all mean "this machine". */
export const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * If `url` points at `origin` (treating localhost, 127.0.0.1 and ::1 as the same host),
 * return it rebased onto `to`. Otherwise null.
 */
export function rebase(url: string, origin: string, to: string): string | null {
  let u: URL;
  let o: URL;
  try {
    u = new URL(url);
    o = new URL(origin);
  } catch {
    return null;
  }
  const sameHost = u.hostname === o.hostname || (LOOPBACK.has(u.hostname) && LOOPBACK.has(o.hostname));
  if (u.protocol !== o.protocol || u.port !== o.port || !sameHost) return null;
  return to + u.pathname + u.search + u.hash;
}
