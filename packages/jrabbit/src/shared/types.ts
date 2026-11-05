/** Shared between the local server and the overlay. Keep it serializable. */

export type PinStatus = "draft" | "open" | "resolved" | "approved";

export interface SourceLocation {
  /** Path relative to the project root when inside it, absolute otherwise. */
  file: string;
  line: number;
  column?: number;
  /** Component that renders this location, when known. */
  component?: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PinElement {
  selector: string;
  tag: string;
  /** First characters of the element's visible text, for re-anchoring. */
  text: string;
  rect: Rect;
  component?: string;
  /** Class names as written on the element. */
  classes?: string[];
  /** A few identifying attributes: id, role, aria-label, alt, href, src, data-testid… */
  attrs?: Record<string, string>;
  /** Computed styles that are set to something other than the browser default. */
  styles?: Record<string, string>;
}

export interface PinEvent {
  at: string;
  status: PinStatus;
  by: "human" | "agent";
  note?: string;
}

export interface Pin {
  id: string;
  /** Human-friendly number, unique per project. */
  n: number;
  status: PinStatus;
  comment: string;
  page: { url: string; path: string; title: string };
  viewport: { width: number; height: number; dpr: number };
  element: PinElement;
  /** Where the pointed element is written in the source. */
  source: SourceLocation | null;
  /** Owner components from the element up, each with its source location. */
  sourceChain: SourceLocation[];
  shots: { before?: string; after?: string };
  resolution?: { summary: string; at: string };
  history: PinEvent[];
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  /** Set when the agent has received the pin through wait_for_feedback. */
  deliveredAt?: string;
  /** Process id of the MCP session that received it. Unset when it went to `jrabbit wait`. */
  deliveredTo?: number;
}

export type RuleStatus = "draft" | "approved";

export interface Rule {
  slug: string;
  title: string;
  status: RuleStatus;
  body: string;
  /** Pin ids this rule was derived from. */
  source: string[];
  createdAt: string;
  /** Path relative to the project root. */
  path: string;
}

/** One entry per React fiber from the pointed element up through its owners. */
export interface DebugEntry {
  component?: string;
  /** Raw V8 stack (React 19 `_debugStack`). */
  stack?: string;
  /** Pre-parsed frames (React server component info): [fn, url, line, column]. */
  frames?: Array<[string, string, number, number]>;
  /** React <= 18 `_debugSource`. */
  source?: { fileName: string; lineNumber: number; columnNumber?: number };
}

export interface NewPinInput {
  comment: string;
  page: Pin["page"];
  viewport: Pin["viewport"];
  element: PinElement;
  debug: DebugEntry[];
  /** PNG data URL. */
  shot?: string | null;
}

/** none: no agent (CLI review). connected: agent attached but not waiting. listening: in wait_for_feedback. */
export type AgentState = "none" | "connected" | "listening";

export interface OverlayState {
  pins: Pin[];
  rules: Rule[];
  target: string | null;
  agent: AgentState;
}

export type ServerEvent =
  | { type: "state"; state: OverlayState }
  | { type: "capture-after"; id: string; selector: string; text: string; path: string }
  | { type: "toast"; message: string };
