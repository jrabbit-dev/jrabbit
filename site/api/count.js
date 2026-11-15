// Counts copies of the setup prompt and of the install command on the landing page.
// A plain counter per day: no id, no cookie, and the IP address is not read or stored.
import { redis } from "./_redis.js";

const EVENTS = new Set(["copy_prompt", "copy_cmd"]);
export const COUNT_TTL = 400 * 86400;

/** Adds one to today's counter for `name`. Never throws. */
export async function count(name) {
  const key = `n:${name}:${new Date().toISOString().slice(0, 10)}`;
  await redis([
    ["INCR", key],
    ["EXPIRE", key, COUNT_TTL],
    ["INCR", `n:${name}:all`],
  ]).catch(() => null);
}

export async function POST(request) {
  const event = new URL(request.url).searchParams.get("e");
  if (!EVENTS.has(event)) return new Response(null, { status: 400 });
  await count(event);
  return new Response(null, { status: 204 });
}
