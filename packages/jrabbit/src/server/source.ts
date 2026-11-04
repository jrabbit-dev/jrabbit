import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FlattenMap, LEAST_UPPER_BOUND, originalPositionFor, type TraceMap } from "@jridgewell/trace-mapping";
import type { DebugEntry, SourceLocation } from "../shared/types.js";

export interface RawFrame {
  fn?: string;
  url: string;
  line: number;
  column: number;
}

const FRAME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;

/** Parse a V8 stack string into frames. Lines that are not frames are ignored. */
export function parseStack(stack: string): RawFrame[] {
  const frames: RawFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const fn = m[1]?.replace(/^async /, "").replace(/^new /, "");
    frames.push({ ...(fn ? { fn } : {}), url: m[2]!, line: Number(m[3]), column: Number(m[4]) });
  }
  return frames;
}

/**
 * React replays server component stacks with fake URLs such as
 * `rsc://React/Server/file:///abs/chunk.js?3`. Return the real URL inside.
 */
export function unwrapReactUrl(url: string): string {
  const m = /^(?:rsc|about):\/\/React\/[^/]+\/(.+)$/.exec(url);
  if (!m?.[1]) return url;
  let inner = m[1];
  try {
    inner = decodeURI(inner);
  } catch {
    /* keep raw */
  }
  return inner.replace(/\?\d+$/, "");
}

const EXTERNAL =
  /(^|[/\\])node_modules[/\\]|^\[turbopack\]|^\[next\]|^\[externals\]|\/next\/dist\/|react-dom|react-server-dom|jsx-dev-runtime|^webpack\/|^\(webpack\)/;

export function isExternalSource(path: string): boolean {
  return EXTERNAL.test(path);
}

/** Turn a source-map `sources` entry into a candidate path (still unverified). */
export function cleanSourcePath(src: string): string {
  let s = src.trim();
  s = s.replace(/\s+\[[^\]]*\](\s+\([^)]*\))?$/, ""); // turbopack: "file.tsx [app-client] (ecmascript)"
  s = s.replace(/^turbopack:\/\/\/\[project\]\//, "");
  s = s.replace(/^turbopack:\/\/\//, "");
  s = s.replace(/^webpack:\/\/[^/]*\//, "");
  s = s.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, "");
  if (s.startsWith("file://")) {
    try {
      s = fileURLToPath(s);
    } catch {
      /* keep */
    }
  }
  if (/^https?:\/\//.test(s)) {
    try {
      s = new URL(s).pathname;
    } catch {
      /* keep */
    }
  }
  s = s.replace(/^\/@fs\//, "/");
  s = s.replace(/[?#].*$/, "");
  s = s.replace(/^\.\//, "");
  return s;
}

/**
 * Find the file on disk. Handles monorepos where the bundler root differs from
 * the project root by trying the path against the root and its ancestors, and by
 * dropping leading segments.
 */
export function locateOnDisk(path: string, root: string): string | null {
  if (isAbsolute(path) && existsSync(path)) return path;
  const clean = path.replace(/^\/+/, "");
  const segments = clean.split(/[/\\]/);
  const bases: string[] = [];
  for (let dir = root, i = 0; i < 4; i++) {
    bases.push(dir);
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const base of bases) {
    for (let i = 0; i < Math.min(segments.length - 1, 4); i++) {
      const candidate = join(base, ...segments.slice(i));
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function displayPath(abs: string, root: string): string {
  const rel = relative(root, abs);
  return rel.startsWith("..") || isAbsolute(rel) ? abs : rel.split(sep).join("/");
}

type Fetcher = (url: string) => Promise<{ body: string; sourceMapHeader?: string } | null>;

/**
 * Maps a frame the dev server bundled with eval source maps (webpack `eval-source-map`),
 * whose maps live inside the browser's `eval` and cannot be fetched.
 */
export type FrameMapper = (frame: RawFrame) => Promise<{ file: string; line: number; column?: number } | null>;

interface Generated {
  map: TraceMap | null;
  /** Where the map lives: `sources` are relative to it. */
  mapUrl?: string;
}

/** Resolves React debug info (stacks or `_debugSource`) to project files via source maps. */
export class SourceResolver {
  private cache = new Map<string, { at: number; value: Promise<Generated> }>();
  private tops = new Map<string, string>();

  /**
   * @param projectRoot project root, or a function returning it (it can change before the first review)
   * @param fetchHttp fetches a URL served by the dev server (already mapped to the target)
   * @param mapEvalFrame maps `webpack-internal:` frames through the dev server
   */
  constructor(
    private projectRoot: string | (() => string),
    private fetchHttp: Fetcher,
    private mapEvalFrame?: FrameMapper,
  ) {}

  private get root(): string {
    return typeof this.projectRoot === "string" ? this.projectRoot : this.projectRoot();
  }

  /** Files outside this folder are never read or reported. */
  private get top(): string {
    const root = this.root;
    let top = this.tops.get(root);
    if (!top) this.tops.set(root, (top = workspaceTop(root)));
    return top;
  }

  async resolve(entries: DebugEntry[]): Promise<{ source: SourceLocation | null; chain: SourceLocation[] }> {
    const chain: SourceLocation[] = [];
    let source: SourceLocation | null = null;
    for (const [i, entry] of entries.slice(0, 12).entries()) {
      const loc = await this.resolveEntry(entry).catch(() => null);
      if (!loc) continue;
      // Each entry's JSX is written inside its owner, the next entry up the chain.
      const component = entries[i + 1]?.component ?? loc.component;
      const withName: SourceLocation = { ...loc, ...(component ? { component } : {}) };
      if (!source) source = withName;
      if (!chain.some((c) => c.file === withName.file && c.line === withName.line)) chain.push(withName);
    }
    return { source, chain };
  }

  private async resolveEntry(entry: DebugEntry): Promise<SourceLocation | null> {
    if (entry.source?.fileName) {
      const abs = this.locate(cleanSourcePath(entry.source.fileName));
      if (abs) {
        return {
          file: displayPath(abs, this.root),
          line: entry.source.lineNumber,
          ...(entry.source.columnNumber ? { column: entry.source.columnNumber } : {}),
        };
      }
    }
    const frames: RawFrame[] = entry.frames
      ? entry.frames.map(([fn, url, line, column]) => ({ fn, url, line, column }))
      : entry.stack
        ? parseStack(entry.stack)
        : [];
    for (const frame of frames.slice(0, 8)) {
      const loc = await this.resolveFrame(frame);
      if (loc) return loc;
    }
    return null;
  }

  async resolveFrame(frame: RawFrame): Promise<SourceLocation | null> {
    const url = unwrapReactUrl(frame.url);
    if (/react-stack-top-frame|node:internal|^native$/.test(url)) return null;

    const component = frame.fn && !/^(eval|Object\.|exports\.|Module\.)/.test(frame.fn) ? { component: frame.fn } : {};
    if (url.startsWith("webpack-internal:") && this.mapEvalFrame && !isExternalSource(cleanSourcePath(url))) {
      const mapped = await this.mapEvalFrame({ ...frame, url }).catch(() => null);
      const abs = mapped && !isExternalSource(cleanSourcePath(mapped.file)) ? this.locate(cleanSourcePath(mapped.file)) : null;
      if (abs) {
        return {
          file: displayPath(abs, this.root),
          line: mapped!.line,
          ...(mapped!.column ? { column: mapped!.column } : {}),
          ...component,
        };
      }
    }

    // Unbundled sources (Vite serves /src/App.tsx) may already point at the file.
    const gen = await this.load(url);
    let original: { source: string; line: number; column: number; name?: string } | null = null;
    if (gen.map) {
      for (const bias of [undefined, LEAST_UPPER_BOUND] as const) {
        const pos = originalPositionFor(gen.map, {
          line: frame.line,
          column: Math.max(0, frame.column - 1),
          ...(bias ? { bias } : {}),
        });
        if (pos.source && pos.line != null) {
          original = { source: pos.source, line: pos.line, column: (pos.column ?? 0) + 1, ...(pos.name ? { name: pos.name } : {}) };
          break;
        }
      }
    }
    // The spec makes `sources` relative to the map (Vite writes just "App.tsx"),
    // but many bundlers write them relative to the project root: try both.
    const candidates = original ? [relativeTo(original.source, gen.mapUrl), original.source] : [url];
    let abs: string | null = null;
    for (const candidate of candidates) {
      const cleaned = candidate && cleanSourcePath(candidate);
      if (!cleaned || isExternalSource(cleaned)) continue;
      if ((abs = this.locate(cleaned))) break;
    }
    if (!abs) return null;
    return {
      file: displayPath(abs, this.root),
      line: original?.line ?? frame.line,
      column: original?.column ?? frame.column,
      ...component,
    };
  }

  private locate(path: string): string | null {
    const abs = locateOnDisk(path, this.root);
    return abs && isInside(abs, this.top) && !isExternalSource(abs) ? abs : null;
  }

  private load(url: string): Promise<Generated> {
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < 3000) return hit.value;
    const value = this.loadUncached(url).catch(() => ({ map: null }));
    this.cache.set(url, { at: Date.now(), value });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }

  private async loadUncached(url: string): Promise<Generated> {
    const file = await this.readGenerated(url);
    if (!file) return { map: null };
    const ref = file.sourceMapHeader ?? lastSourceMappingUrl(file.body);
    if (!ref) return { map: null };
    const base = url.startsWith("/") ? pathToFileURL(url).href : url;
    let raw: string | null = null;
    let mapUrl = base;
    if (ref.startsWith("data:")) raw = decodeDataUrl(ref);
    else {
      mapUrl = new URL(ref, base).href;
      raw = (await this.readGenerated(mapUrl))?.body ?? null;
    }
    if (!raw) return { map: null };
    return { map: new FlattenMap(JSON.parse(raw)) as unknown as TraceMap, mapUrl };
  }

  private async readGenerated(url: string): Promise<{ body: string; sourceMapHeader?: string } | null> {
    if (url.startsWith("file://") || isAbsolute(url)) {
      const path = url.startsWith("file://") ? fileURLToPath(url) : url;
      // Only read build output and project files, never arbitrary paths.
      const abs = resolve(path);
      if (!/\.(m?js|cjs|map)$/.test(abs)) return null;
      if (!isInside(abs, this.top)) return null;
      if (!existsSync(abs)) return null;
      return { body: await readFile(abs, "utf8") };
    }
    if (/^https?:\/\//.test(url)) return this.fetchHttp(url);
    return null;
  }
}

/** A relative `sources` entry resolved against the map URL, or null when it is already absolute. */
function relativeTo(source: string, mapUrl: string | undefined): string | null {
  if (!mapUrl || /^[a-z][\w+.-]*:/i.test(source) || source.startsWith("/")) return null;
  try {
    return new URL(source, mapUrl).href;
  } catch {
    return null;
  }
}

/** The repository containing `root` (nearest ancestor with .git, up to 4 levels), else `root`. */
export function workspaceTop(root: string): string {
  for (let dir = resolve(root), i = 0; i < 5; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return resolve(root);
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function lastSourceMappingUrl(code: string): string | null {
  const re = /\/[/*][#@]\s*sourceMappingURL=([^\s*'"]+)/g;
  let last: string | null = null;
  for (let m = re.exec(code); m; m = re.exec(code)) last = m[1] ?? null;
  return last;
}

function decodeDataUrl(url: string): string | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  return meta.includes(";base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
}
