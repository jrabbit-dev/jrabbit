// Resend calls this when mail arrives at @jrabbit.dev. It forwards the message to the
// maintainer's inbox, with Reply-To set to the original sender.
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.resend.com";

/** Resend signs webhooks the Svix way: HMAC-SHA256 over "id.timestamp.body". */
function signed(request, body, secret) {
  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const header = request.headers.get("svix-signature");
  if (!id || !timestamp || !header || !secret) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false; // replayed
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return header.split(" ").some((part) => {
    const given = Buffer.from(part.split(",")[1] ?? "", "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

export async function POST(request) {
  const body = await request.text();
  if (!signed(request, body, process.env.RESEND_WEBHOOK_SECRET)) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(body);
  if (event.type !== "email.received") return Response.json({ ignored: event.type });

  const key = process.env.RESEND_API_KEY;
  const to = process.env.MAIL_FORWARD_TO;
  if (!key || !to) return new Response("not configured", { status: 500 });
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };

  // The webhook carries only the envelope; the body is fetched by id.
  const meta = event.data ?? {};
  const res = await fetch(`${API}/emails/receiving/${meta.email_id}`, { headers });
  const mail = res.ok ? await res.json() : {};
  const from = mail.from ?? meta.from ?? "unknown sender";
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const rcpt = [].concat(mail.to ?? meta.to ?? []).join(", ");
  const files = (mail.attachments ?? meta.attachments ?? []).length;
  const note = `From ${from} to ${rcpt}${files ? ` · ${files} attachment${files === 1 ? "" : "s"} not forwarded` : ""}`;

  const sent = await fetch(`${API}/emails`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: `jrabbit mail <info@${process.env.RESEND_EMAIL_DOMAIN || "jrabbit.dev"}>`,
      to: [to],
      reply_to: address,
      subject: mail.subject ?? meta.subject ?? "(no subject)",
      text: `${note}\n\n${mail.text ?? ""}`,
      html: `<p style="color:#666;font:13px sans-serif">${escape(note)}</p>${mail.html ?? `<pre>${escape(mail.text ?? "")}</pre>`}`,
    }),
  });
  if (!sent.ok) return new Response(`forward failed: ${sent.status}`, { status: 502 });
  return Response.json({ forwarded: true });
}
