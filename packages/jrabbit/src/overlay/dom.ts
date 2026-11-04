import { domToPng } from "modern-screenshot";
import type { DebugEntry, PinElement } from "../shared/types.js";

const isUnique = (sel: string) => {
  try {
    return document.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
};

const cssId = (id: string) => (/^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : null);

/** Short, unique CSS selector. Prefers ids and test attributes over position. */
export function selectorFor(el: Element): string {
  const id = el.id ? cssId(el.id) : null;
  if (id && isUnique(id)) return id;
  for (const attr of ["data-testid", "data-test", "data-cy"]) {
    const v = el.getAttribute(attr);
    if (v) {
      const sel = `[${attr}="${CSS.escape(v)}"]`;
      if (isUnique(sel)) return sel;
    }
  }
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    const curId = cur.id ? cssId(cur.id) : null;
    if (curId && isUnique(curId)) {
      parts.unshift(curId);
      break;
    }
    let part = cur.tagName.toLowerCase();
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    if (isUnique(parts.join(" > "))) break;
    cur = parent;
  }
  return parts.join(" > ");
}

export function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Find the element again after a reload or HMR: selector first, then tag + text. */
export function findElement(selector: string, text: string): Element | null {
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch {
    /* invalid selector */
  }
  if (!text) return null;
  const tag = /([a-z0-9-]+)(?::nth-of-type\(\d+\))?$/i.exec(selector)?.[1] ?? "*";
  for (const el of Array.from(document.querySelectorAll(tag))) if (textOf(el) === text) return el;
  return null;
}

// ---------- React ----------

type Fiber = Record<string, any>;

function fiberOf(el: Element): Fiber | null {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const key = Object.keys(cur).find((k) => k.startsWith("__reactFiber$"));
    if (key) return (cur as any)[key];
  }
  return null;
}

function nameOf(type: any): string | undefined {
  if (!type) return undefined;
  if (typeof type === "string") return type;
  return type.displayName || type.name || nameOf(type.render) || nameOf(type.type) || undefined;
}

/**
 * Debug info from the element's fiber up through its owners.
 * React 19 keeps the JSX creation stack in `_debugStack`; React <= 18 has `_debugSource`.
 * Server component owners carry `debugStack` or a parsed `stack` array.
 */
export function reactDebug(el: Element): { entries: DebugEntry[]; component?: string } {
  const fiber = fiberOf(el);
  if (!fiber) return { entries: [] };
  const entries: DebugEntry[] = [];
  const seen = new Set<unknown>();
  let cur: Fiber | null = fiber;
  while (cur && entries.length < 12 && !seen.has(cur)) {
    seen.add(cur);
    const entry: DebugEntry = {};
    const name = nameOf(cur.type) ?? (typeof cur.name === "string" ? cur.name : undefined);
    if (name) entry.component = name;
    const stack = cur._debugStack?.stack ?? cur.debugStack?.stack;
    if (typeof stack === "string") entry.stack = stack;
    else if (Array.isArray(cur.stack)) entry.frames = cur.stack;
    const src = cur._debugSource;
    if (src?.fileName) entry.source = { fileName: src.fileName, lineNumber: src.lineNumber, columnNumber: src.columnNumber };
    entries.push(entry);
    cur = cur._debugOwner ?? cur.owner ?? null;
  }
  const component = entries.slice(1).find((e) => e.component)?.component;
  return { entries, ...(component ? { component } : {}) };
}

// ---------- capture ----------

/** Computed styles worth telling the agent about. Size comes from the rect. */
const STYLE_PROPS = [
  "display", "position", "margin", "padding", "gap", "flex-direction", "justify-content", "align-items",
  "grid-template-columns", "color", "background-color", "background-image", "border", "border-radius",
  "box-shadow", "opacity", "font-family", "font-size", "font-weight", "line-height", "letter-spacing",
  "text-align", "text-transform", "object-fit", "mix-blend-mode", "filter", "z-index",
];

/** Browser defaults: leaving them out keeps the pin short. */
const DEFAULTS = new Set(["", "none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)", "static", "start", "fill", "row", "block", "inline"]);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function stylesOf(el: Element): Record<string, string> {
  const cs = getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const v = cs.getPropertyValue(prop).trim();
    if (DEFAULTS.has(v) || (prop === "opacity" && v === "1") || (prop === "border" && /^0px none/.test(v))) continue;
    out[prop] = clip(v, 120);
  }
  return out;
}

const ATTRS = ["id", "role", "aria-label", "alt", "title", "href", "src", "placeholder", "type", "name", "data-testid"];

export function attrsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ATTRS) {
    const v = el.getAttribute(name);
    if (!v || v.startsWith("data:")) continue;
    out[name] = clip(v, 160);
  }
  return out;
}

export function describe(el: Element): PinElement {
  const r = el.getBoundingClientRect();
  const { component } = reactDebug(el);
  const classes = Array.from(el.classList).slice(0, 24);
  const attrs = attrsOf(el);
  return {
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: textOf(el),
    rect: { x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
    ...(component ? { component } : {}),
    ...(classes.length ? { classes } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    styles: stylesOf(el),
  };
}

function backgroundOf(el: Element): string {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
  }
  return "#ffffff";
}

/**
 * Longest side of a screenshot, in pixels. Vision models downscale anything much larger,
 * so bigger shots only cost the agent context.
 */
const MAX_SHOT_SIDE = 1200;

/** PNG data URL of the element, at up to 2x device resolution, capped at MAX_SHOT_SIDE. */
export async function capture(el: Element, host: Element): Promise<string | null> {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const scale = Math.min(window.devicePixelRatio || 1, 2, MAX_SHOT_SIDE / Math.max(r.width, r.height));
  try {
    return await domToPng(el, {
      scale,
      backgroundColor: backgroundOf(el),
      // The element's own margin would push it inside the shot and crop it.
      style: { margin: "0" },
      filter: (node) => node !== host,
      timeout: 8000,
    });
  } catch {
    return null;
  }
}
