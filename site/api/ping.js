// Anonymous usage count. jrabbit sends one ping a day per machine: a random id, the version,
// the agent's name and the OS. Ids go into HyperLogLog counters, so only "how many distinct" is kept.
// The request's IP address is not read or stored.
import { redis } from "./_redis.js";

const DAY_TTL = 400 * 86400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const label = (value, known) => (typeof value === "string" && known.test(value) ? value.toLowerCase() : "unknown");

export async function POST(request) {
  const text = await request.text();
  if (text.length > 500) return new Response(null, { status: 413 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const { id, v } = body ?? {};
  if (typeof id !== "string" || !UUID.test(id) || typeof v !== "string" || !/^\d+\.\d+\.\d+$/.test(v)) {
    return new Response(null, { status: 400 });
  }
  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  await redis([
    ["PFADD", `u:d:${day}`, id],
    ["EXPIRE", `u:d:${day}`, DAY_TTL],
    ["PFADD", `u:m:${month}`, id],
    ["PFADD", "u:all", id],
    ["HINCRBY", `v:${month}`, v, 1],
    ["HINCRBY", `c:${month}`, label(body.client, /^[a-z0-9 ._-]{1,40}$/i), 1],
    ["HINCRBY", `os:${month}`, label(body.os, /^[a-z0-9]{1,12}$/i), 1],
  ]).catch(() => null);
  return new Response(null, { status: 204 });
}
