// Usage numbers for the maintainer: distinct machines that used jrabbit, from the pings in ping.js.
// Needs "Authorization: Bearer $STATS_TOKEN".
import { timingSafeEqual } from "node:crypto";
import { redis } from "./_redis.js";

function allowed(request) {
  const token = process.env.STATS_TOKEN;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!token || given.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(token));
}

const days = (n) =>
  Array.from({ length: n }, (_, i) => `u:d:${new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10)}`);

/** HGETALL comes back as a flat [field, value, …] list. */
const pairs = (flat) => {
  const out = {};
  for (let i = 0; i < (flat?.length ?? 0); i += 2) out[flat[i]] = Number(flat[i + 1]);
  return out;
};

export async function GET(request) {
  if (!allowed(request)) return new Response("unauthorized", { status: 401 });
  const month = new Date().toISOString().slice(0, 7);
  const r = await redis([
    ["PFCOUNT", ...days(1)],
    ["PFCOUNT", ...days(7)],
    ["PFCOUNT", ...days(30)],
    ["PFCOUNT", "u:all"],
    ["HGETALL", `v:${month}`],
    ["HGETALL", `c:${month}`],
    ["HGETALL", `os:${month}`],
  ]);
  if (!r) return new Response("store not connected", { status: 503 });
  return Response.json({
    machines: { today: r[0], last7days: r[1], last30days: r[2], allTime: r[3] },
    // Days of use this month, split three ways.
    thisMonth: { versions: pairs(r[4]), agents: pairs(r[5]), os: pairs(r[6]) },
  });
}
