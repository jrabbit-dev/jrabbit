import { describe, expect, it } from "vitest";
import { MASK, isSensitiveField, maskClonedField } from "../src/overlay/sensitive.js";

/** Minimal stand-in for a cloned element. */
function field(nodeName: string, attrs: Record<string, string> = {}, text: string | null = null) {
  const a = new Map(Object.entries(attrs));
  return {
    nodeName,
    textContent: text,
    getAttribute: (n: string) => a.get(n) ?? null,
    setAttribute: (n: string, v: string) => void a.set(n, v),
  };
}

describe("isSensitiveField", () => {
  it("masks password and hidden inputs", () => {
    expect(isSensitiveField(field("INPUT", { type: "password" }))).toBe(true);
    expect(isSensitiveField(field("input", { type: "HIDDEN" }))).toBe(true);
  });

  it("masks payment, credential and one-time-code autocomplete", () => {
    for (const ac of ["cc-number", "cc-csc", "billing cc-exp", "section-a cc-name", "one-time-code", "current-password", "new-password"]) {
      expect(isSensitiveField(field("INPUT", { type: "text", autocomplete: ac })), ac).toBe(true);
    }
  });

  it("masks plain text fields named like secrets", () => {
    expect(isSensitiveField(field("INPUT", { name: "api_key" }))).toBe(true);
    expect(isSensitiveField(field("INPUT", { id: "accessToken" }))).toBe(true);
    expect(isSensitiveField(field("INPUT", { "aria-label": "Card number" }))).toBe(true);
    expect(isSensitiveField(field("INPUT", { placeholder: "CVV" }))).toBe(true);
    expect(isSensitiveField(field("TEXTAREA", { name: "private-key" }))).toBe(true);
  });

  it("leaves ordinary fields and other tags alone", () => {
    expect(isSensitiveField(field("INPUT", { type: "text", name: "city", autocomplete: "address-level2" }))).toBe(false);
    expect(isSensitiveField(field("INPUT", { type: "email", autocomplete: "email" }))).toBe(false);
    expect(isSensitiveField(field("TEXTAREA", { name: "comment" }))).toBe(false);
    expect(isSensitiveField(field("DIV", { id: "token" }))).toBe(false);
  });

  it("honours data-jrabbit-mask both ways", () => {
    expect(isSensitiveField(field("INPUT", { name: "city", "data-jrabbit-mask": "" }))).toBe(true);
    expect(isSensitiveField(field("INPUT", { name: "token_count", "data-jrabbit-mask": "false" }))).toBe(false);
  });
});

describe("maskClonedField", () => {
  it("replaces an input's value with a fixed-width mask", () => {
    const el = field("INPUT", { autocomplete: "cc-number", value: "4242 4242 4242 4242" });
    maskClonedField(el);
    expect(el.getAttribute("value")).toBe(MASK);
  });

  it("keeps empty fields empty so the placeholder still shows", () => {
    const el = field("INPUT", { name: "password" });
    maskClonedField(el);
    expect(el.getAttribute("value")).toBeNull();
  });

  it("replaces a textarea's text", () => {
    const el = field("TEXTAREA", { name: "secret", value: "-----BEGIN KEY-----" }, "-----BEGIN KEY-----");
    maskClonedField(el);
    expect(el.textContent).toBe(MASK);
  });

  it("does not touch ordinary fields", () => {
    const el = field("INPUT", { name: "city", value: "Montevideo" });
    maskClonedField(el);
    expect(el.getAttribute("value")).toBe("Montevideo");
  });
});
