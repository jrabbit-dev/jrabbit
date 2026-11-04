import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

/** Files-only store in `<root>/.jrabbit/`. One JSON file per pin, PNG shots, Markdown rules. */
export class Store {
  readonly dir: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly root: string) {
    this.dir = join(root, ".jrabbit");
  }

  async init(): Promise<void> {
    await mkdir(join(this.dir, "pins"), { recursive: true });
    await mkdir(join(this.dir, "shots"), { recursive: true });
    await mkdir(join(this.dir, "rules"), { recursive: true });
    const gi = join(this.dir, ".gitignore");
    if (!existsSync(gi)) await writeFile(gi, GITIGNORE);
  }

  /** Serialize writes so pin numbers and read-modify-write updates never race. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
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
      const pin: Pin = {
        id,
        n: pins.reduce((max, p) => Math.max(max, p.n), 0) + 1,
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
