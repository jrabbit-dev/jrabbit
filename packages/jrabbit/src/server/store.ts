import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { NewPinInput, Pin, PinStatus, Rule, RuleStatus, SourceLocation } from "../shared/types.js";

const GITIGNORE = `# jrabbit local store. Only rules/ is meant to be versioned.
*
!.gitignore
!rules/
!rules/**
`;

const now = () => new Date().toISOString();

/** agent: an agent is waiting for pins. overlay: a browser has the review open. human: the human did something in the review. */
export type Heartbeat = "agent" | "overlay" | "human";

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A lock older than this is considered abandoned (its process crashed mid-write). */
const STALE_LOCK_MS = 10_000;

/** Files-only store in `<root>/.jrabbit/`. One JSON file per pin, PNG shots, Markdown rules. */
export class Store {
  private _root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | null = null;

  constructor(root: string) {
    this._root = root;
  }

  get root(): string {
    return this._root;
  }

  get dir(): string {
    return join(this._root, ".jrabbit");
  }

  /** Point the store at another project folder. Only before first use. */
  useRoot(root: string): void {
    if (this.ready) throw new Error("The store is already in use");
    this._root = root;
  }

  init(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(join(this.dir, "pins"), { recursive: true });
      await mkdir(join(this.dir, "shots"), { recursive: true });
      await mkdir(join(this.dir, "rules"), { recursive: true });
      await mkdir(join(this.dir, "archive", "shots"), { recursive: true });
      const gi = join(this.dir, ".gitignore");
      if (!existsSync(gi)) await writeFile(gi, GITIGNORE);
    })().catch((err) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  /**
   * Serialize writes so pin numbers and read-modify-write updates never race:
   * an in-process queue plus a lock directory shared with other jrabbit processes
   * on the same project (two agent sessions, or an agent and `jrabbit open`).
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.init();
      const release = await this.lock();
      try {
        return await fn();
      } finally {
        await release();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async lock(): Promise<() => Promise<void>> {
    const dir = join(this.dir, ".lock");
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(dir); // atomic: fails if another process holds the lock
        return () => rm(dir, { recursive: true, force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        const age = await stat(dir).then((s) => Date.now() - s.mtimeMs, () => 0);
        if (age > STALE_LOCK_MS) await rm(dir, { recursive: true, force: true });
        else await sleep(Math.min(5 + attempt * 5, 50));
      }
    }
  }

  /**
   * Token that authorizes the overlay. Kept in `.jrabbit/` (git-ignored) so a review tab
   * keeps working when the agent restarts, and every jrabbit process on the project agrees.
   */
  token(): Promise<string> {
    return this.exclusive(async () => {
      const file = join(this.dir, "token");
      try {
        const existing = (await readFile(file, "utf8")).trim();
        if (/^[\w-]{32,}$/.test(existing)) return existing;
      } catch {
        /* first run */
      }
      const token = randomBytes(24).toString("base64url");
      await writeFile(file, token + "\n", { mode: 0o600 });
      return token;
    });
  }

  // ---------- pins ----------

  async listPins(): Promise<Pin[]> {
    const dir = join(this.dir, "pins");
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const pins = await Promise.all(
      files.map(async (f) => {
        try {
          return JSON.parse(await readFile(join(dir, f), "utf8")) as Pin;
        } catch {
          return null;
        }
      }),
    );
    return pins.filter((p): p is Pin => p !== null).sort((a, b) => a.n - b.n);
  }

  async getPin(idOrNumber: string | number): Promise<Pin | null> {
    const pins = await this.listPins();
    const key = String(idOrNumber).replace(/^#/, "");
    return pins.find((p) => p.id === key || String(p.n) === key) ?? null;
  }

  private async writePin(pin: Pin): Promise<void> {
    const file = join(this.dir, "pins", `${pin.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(pin, null, 2));
    await rename(tmp, file);
  }

  createPin(
    input: Omit<NewPinInput, "debug" | "shot">,
    source: SourceLocation | null,
    sourceChain: SourceLocation[],
    shot?: string | null,
  ): Promise<Pin> {
    return this.exclusive(async () => {
      const pins = await this.listPins();
      const id = `pin_${randomBytes(4).toString("hex")}`;
      const at = now();
      // Archived pins keep their numbers: never hand out a number twice.
      const n = Math.max(await this.lastNumber(), ...pins.map((p) => p.n)) + 1;
      await writeFile(join(this.dir, "last-n"), `${n}\n`);
      const pin: Pin = {
        id,
        n,
        status: "draft",
        comment: input.comment.trim(),
        page: input.page,
        viewport: input.viewport,
        element: input.element,
        source,
        sourceChain,
        shots: {},
        history: [{ at, status: "draft", by: "human" }],
        createdAt: at,
        updatedAt: at,
      };
      if (shot) pin.shots.before = await this.saveShot(id, "before", shot);
      await this.writePin(pin);
      return pin;
    });
  }

  /** Read-modify-write a pin atomically. Returns null when the pin does not exist. */
  updatePin(id: string, fn: (pin: Pin) => Pin | void): Promise<Pin | null> {
    return this.exclusive(async () => {
      const pin = await this.getPin(id);
      if (!pin) return null;
      const next = fn(pin) ?? pin;
      next.updatedAt = now();
      await this.writePin(next);
      return next;
    });
  }

  /**
   * Pins the human sent that no agent has received yet, marked as delivered in the same
   * locked step so two agent sessions never both pick up the same pin.
   *
   * An MCP session passes its pid as `owner`. It also takes back open pins that went to a
   * session that is gone (or to `jrabbit wait`) without being resolved, so none is stuck.
   */
  claimUndelivered(owner?: number): Promise<{ pins: Pin[]; redelivered: Pin[] }> {
    return this.exclusive(async () => {
      const orphan = (p: Pin) => owner !== undefined && p.deliveredTo !== owner && !alive(p.deliveredTo);
      const pins = (await this.listPins()).filter((p) => p.status === "open" && (!p.deliveredAt || orphan(p)));
      const redelivered = pins.filter((p) => p.deliveredAt);
      const at = now();
      for (const p of pins) {
        p.deliveredAt = at;
        if (owner !== undefined) p.deliveredTo = owner;
        else delete p.deliveredTo;
        p.updatedAt = at;
        await this.writePin(p);
      }
      return { pins, redelivered };
    });
  }

  /**
   * Heartbeat files shared by every jrabbit process on the project:
   * `.agent` while an agent waits for pins, `.overlay` while a browser is connected to a review.
   */
  async beat(name: Heartbeat): Promise<void> {
    const file = join(this.dir, `.${name}`);
    const t = new Date();
    await utimes(file, t, t).catch(() => writeFile(file, "")).catch(() => undefined);
  }

  async fresh(name: Heartbeat, ms = 4000): Promise<boolean> {
    const s = await stat(join(this.dir, `.${name}`)).catch(() => null);
    return !!s && Date.now() - s.mtimeMs < ms;
  }

  /** Milliseconds since the last beat, or null when there never was one. */
  async age(name: Heartbeat): Promise<number | null> {
    const s = await stat(join(this.dir, `.${name}`)).catch(() => null);
    return s ? Date.now() - s.mtimeMs : null;
  }

  /**
   * The human (or the agent, on their word) ended the review. Agents stop waiting until
   * the review is opened again or the human sends another pin.
   */
  async setClosed(closed: boolean): Promise<void> {
    const file = join(this.dir, ".closed");
    if (closed) await writeFile(file, "").catch(() => undefined);
    else await rm(file, { force: true }).catch(() => undefined);
  }

  isClosed(): boolean {
    return existsSync(join(this.dir, ".closed"));
  }

  private async lastNumber(): Promise<number> {
    const n = Number((await readFile(join(this.dir, "last-n"), "utf8").catch(() => "0")).trim());
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Move approved pins and their screenshots to `.jrabbit/archive/`, out of every list.
   * Pass ids or numbers to archive only those (they must be approved). Returns what was archived.
   */
  archivePins(refs?: Array<string | number>): Promise<Pin[]> {
    return this.exclusive(async () => {
      const keys = refs?.map((r) => String(r).replace(/^#/, ""));
      const pins = (await this.listPins()).filter(
        (p) => p.status === "approved" && (!keys || keys.includes(p.id) || keys.includes(String(p.n))),
      );
      const archive = join(this.dir, "archive");
      for (const pin of pins) {
        for (const kind of ["before", "after"] as const) {
          const rel = pin.shots[kind];
          const abs = rel ? this.shotFile(rel) : null;
          if (!abs || !existsSync(abs)) continue;
          const to = join(archive, "shots", abs.split(/[\\/]/).pop()!);
          await rename(abs, to);
          pin.shots[kind] = relative(this.root, to);
        }
        await writeFile(join(archive, `${pin.id}.json`), JSON.stringify(pin, null, 2));
        await rm(join(this.dir, "pins", `${pin.id}.json`), { force: true });
      }
      return pins;
    });
  }

  setStatus(pin: Pin, status: PinStatus, by: "human" | "agent", note?: string): void {
    pin.status = status;
    pin.history.push({ at: now(), status, by, ...(note ? { note } : {}) });
  }

  deletePin(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const pin = await this.getPin(id);
      if (!pin || pin.status !== "draft") return false;
      await rm(join(this.dir, "pins", `${pin.id}.json`), { force: true });
      for (const shot of Object.values(pin.shots)) if (shot) await rm(join(this.root, shot), { force: true });
      return true;
    });
  }

  // ---------- shots ----------

  async saveShot(id: string, kind: "before" | "after", dataUrl: string): Promise<string> {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!m?.[1]) throw new Error("Screenshot must be a PNG data URL");
    const file = join(this.dir, "shots", `${id}-${kind}.png`);
    await writeFile(file, Buffer.from(m[1], "base64"));
    return relative(this.root, file);
  }

  /** Resolve a shot path from a pin, refusing anything outside `.jrabbit/shots`. */
  shotFile(rel: string): string | null {
    const abs = join(this.root, rel);
    const shots = join(this.dir, "shots");
    return abs.startsWith(shots + "/") || abs.startsWith(shots + "\\") ? abs : null;
  }

  async readShotBase64(rel: string | undefined): Promise<string | null> {
    if (!rel) return null;
    const abs = this.shotFile(rel);
    if (!abs || !existsSync(abs)) return null;
    return (await readFile(abs)).toString("base64");
  }

  // ---------- rules ----------

  async listRules(): Promise<Rule[]> {
    const dir = join(this.dir, "rules");
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    const rules = await Promise.all(files.map((f) => this.readRule(f.replace(/\.md$/, ""))));
    return rules.filter((r): r is Rule => r !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async readRule(slug: string): Promise<Rule | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
    const file = join(this.dir, "rules", `${slug}.md`);
    if (!existsSync(file)) return null;
    return parseRule(slug, await readFile(file, "utf8"), relative(this.root, file));
  }

  writeRule(input: { title: string; body: string; source: string[] }): Promise<Rule> {
    return this.exclusive(async () => {
      let slug = slugify(input.title);
      let i = 2;
      while (existsSync(join(this.dir, "rules", `${slug}.md`))) slug = `${slugify(input.title)}-${i++}`;
      const rule: Rule = {
        slug,
        title: input.title.trim(),
        status: "draft",
        body: input.body.trim(),
        source: input.source,
        createdAt: now(),
        path: relative(this.root, join(this.dir, "rules", `${slug}.md`)),
      };
      await writeFile(join(this.root, rule.path), serializeRule(rule));
      return rule;
    });
  }

  /**
   * Change a rule's title or text. An approved rule goes back to draft: the human
   * approves the new wording before it applies.
   */
  updateRule(slug: string, change: { title?: string; body?: string }): Promise<Rule | null> {
    return this.exclusive(async () => {
      const rule = await this.readRule(slug);
      if (!rule) return null;
      if (change.title?.trim()) rule.title = change.title.trim();
      if (change.body?.trim()) rule.body = change.body.trim();
      rule.status = "draft";
      await writeFile(join(this.root, rule.path), serializeRule(rule));
      return rule;
    });
  }

  /** Delete a rule file. Returns false when it does not exist. */
  deleteRule(slug: string): Promise<boolean> {
    return this.exclusive(async () => {
      const rule = await this.readRule(slug);
      if (!rule) return false;
      await rm(join(this.root, rule.path), { force: true });
      return true;
    });
  }

  setRuleStatus(slug: string, status: RuleStatus): Promise<Rule | null> {
    return this.exclusive(async () => {
      const rule = await this.readRule(slug);
      if (!rule) return null;
      rule.status = status;
      await writeFile(join(this.root, rule.path), serializeRule(rule));
      return rule;
    });
  }
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "rule"
  );
}

export function serializeRule(r: Rule): string {
  return `---
title: ${JSON.stringify(r.title)}
status: ${r.status}
source: [${r.source.map((s) => JSON.stringify(s)).join(", ")}]
created: ${r.createdAt}
---

${r.body}
`;
}

export function parseRule(slug: string, text: string, path: string): Rule {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const parseJson = <T>(v: string | undefined, fallback: T): T => {
    try {
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return (v as T) ?? fallback;
    }
  };
  return {
    slug,
    title: parseJson(meta.title, slug),
    status: meta.status === "approved" ? "approved" : "draft",
    source: parseJson<string[]>(meta.source, []),
    createdAt: meta.created ?? "",
    body: (m?.[2] ?? text).trim(),
    path,
  };
}
