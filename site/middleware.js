// Counts reads of the setup guide: each one is an agent starting an install.
// A plain counter per day. Nothing about the reader is stored, and the guide is served untouched.
import { count } from "./api/count.js";

export const config = { matcher: "/start.md" };

const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime/i;

export default function middleware(request, context) {
  try {
    const agent = request.headers.get("user-agent") ?? "";
    if (request.method === "GET" && !BOT.test(agent)) context.waitUntil(count("guide"));
  } catch {
    // counting never gets in the way of the guide
  }
  // Continue to the static file.
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}
