import type { Pin } from "./types.js";

/** How long the agent took, from Send to resolved: "14 s", "2 min". Null when unknown. */
export function took(pin: Pin): string | null {
  if (!pin.sentAt || !pin.resolution) return null;
  const s = Math.round((Date.parse(pin.resolution.at) - Date.parse(pin.sentAt)) / 1000);
  if (!Number.isFinite(s) || s < 0) return null;
  return s < 90 ? `${Math.max(1, s)} s` : `${Math.round(s / 60)} min`;
}
