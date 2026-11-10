/**
 * Which form fields must never show their value in a screenshot (SECURITY.md #7).
 * Kept free of DOM globals so it runs in tests and works on nodes from any document.
 */

/** Anything with getAttribute: a live element, a clone, or a test stub. */
export interface FieldLike {
  nodeName: string;
  getAttribute(name: string): string | null;
}

const MASKED_TYPES = new Set(["password", "hidden"]);

/** Autocomplete tokens for credentials, payment cards and one-time codes. */
const MASKED_AUTOCOMPLETE = /^(cc-.+|current-password|new-password|one-time-code|webauthn)$/;

/** Names, ids and labels that usually hold a secret, even on a plain text field. */
const SECRET_HINT =
  /pass(word|wd|code|phrase)?|pwd|secret|token|api[\s_-]?key|private[\s_-]?key|otp|one[\s_-]?time|cvv|cvc|csc|card[\s_-]?(number|num|no)|cc[\s_-]?(number|num)|ssn|social[\s_-]?security|iban|routing[\s_-]?number/i;

const HINT_ATTRS = ["name", "id", "aria-label", "placeholder", "data-testid"];

/** True for inputs and textareas whose value must be masked. */
export function isSensitiveField(el: FieldLike): boolean {
  const tag = el.nodeName.toUpperCase();
  if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
  // Opt-in and opt-out, for fields our heuristics get wrong.
  const flag = el.getAttribute("data-jrabbit-mask");
  if (flag !== null) return flag !== "false";
  if (MASKED_TYPES.has((el.getAttribute("type") ?? "").toLowerCase())) return true;
  const autocomplete = (el.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (autocomplete.some((t) => MASKED_AUTOCOMPLETE.test(t))) return true;
  return HINT_ATTRS.some((name) => SECRET_HINT.test(el.getAttribute(name) ?? ""));
}

/** Fixed width so the shot does not leak the value's length either. */
export const MASK = "••••••••";

/**
 * Masks a cloned field in place. modern-screenshot renders an input from its `value`
 * attribute and a textarea from its text, so both are replaced.
 */
export function maskClonedField(el: FieldLike & { setAttribute(n: string, v: string): void; textContent: string | null }): void {
  if (!isSensitiveField(el)) return;
  const tag = el.nodeName.toUpperCase();
  if (tag === "INPUT") {
    if (el.getAttribute("value")) el.setAttribute("value", MASK);
  } else if (el.textContent || el.getAttribute("value")) {
    el.textContent = MASK;
    el.setAttribute("value", MASK);
  }
}
