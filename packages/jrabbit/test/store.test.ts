import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store, parseRule, serializeRule, slugify } from "../src/server/store.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const input = (comment: string) => ({
  comment,
  page: { url: "http://localhost:4100/", path: "/", title: "Home" },
  viewport: { width: 1280, height: 800, dpr: 2 },
  element: { selector: "main > h1", tag: "h1", text: "Hello", rect: { x: 0, y: 0, width: 10, height: 10 } },
});

async function store() {
  const s = new Store(mkdtempSync(join(tmpdir(), "jrabbit-store-")));
  await s.init();
  return s;
}

describe("Store", () => {
  it("keeps its data out of git except rules", async () => {
    const s = await store();
    expect(readFileSync(join(s.dir, ".gitignore"), "utf8")).toContain("!rules/");
  });

  it("numbers pins in order, also under concurrent writes", async () => {
    const s = await store();
    const pins = await Promise.all(["a", "b", "c"].map((c) => s.createPin(input(c), null, [])));
    expect(pins.map((p) => p.n).sort()).toEqual([1, 2, 3]);
    expect((await s.getPin("#2"))?.n).toBe(2);
  });

  it("stores the before shot and only deletes drafts", async () => {
    const s = await store();
    const pin = await s.createPin(input("x"), null, [], PNG);
    expect(pin.shots.before).toBe(join(".jrabbit", "shots", `${pin.id}-before.png`));
    expect(existsSync(join(s.root, pin.shots.before!))).toBe(true);

    await s.updatePin(pin.id, (p) => s.setStatus(p, "open", "human"));
    expect(await s.deletePin(pin.id)).toBe(false);
  });

  it("rejects non-PNG shots and paths outside the shots folder", async () => {
    const s = await store();
    await expect(s.saveShot("pin_1", "before", "data:text/html;base64,PGgxPg==")).rejects.toThrow();
    expect(s.shotFile("../../etc/passwd")).toBeNull();
    expect(s.shotFile(".jrabbit/shots/../pins/x.json")).toBeNull();
  });

  it("writes rules as markdown and round-trips them", async () => {
    const s = await store();
    const rule = await s.writeRule({ title: "Buttons use the accent color", body: "Primary CTAs use --accent.", source: ["#1"] });
    expect(rule.slug).toBe("buttons-use-the-accent-color");
    expect(rule.status).toBe("draft");
    expect((await s.setRuleStatus(rule.slug, "approved"))?.status).toBe("approved");
    const back = parseRule(rule.slug, serializeRule({ ...rule, status: "approved" }), rule.path);
    expect(back).toMatchObject({ title: rule.title, body: rule.body, status: "approved", source: ["#1"] });
  });

  it("archives approved pins with their shots and never reuses their numbers", async () => {
    const s = await store();
    const one = await s.createPin(input("a"), null, [], PNG);
    await s.createPin(input("b"), null, []);
    await s.updatePin(one.id, (p) => s.setStatus(p, "approved", "human"));

    const archived = await s.archivePins();
    expect(archived.map((p) => p.n)).toEqual([1]);
    expect((await s.listPins()).map((p) => p.n)).toEqual([2]);
    expect(existsSync(join(s.dir, "archive", `${one.id}.json`))).toBe(true);
    expect(existsSync(join(s.root, one.shots.before!))).toBe(false);
    expect(existsSync(join(s.dir, "archive", "shots", `${one.id}-before.png`))).toBe(true);

    expect((await s.createPin(input("c"), null, [])).n).toBe(3);
    expect(await s.archivePins()).toEqual([]);
  });

  it("edits rules back to draft and deletes them", async () => {
    const s = await store();
    const rule = await s.writeRule({ title: "Spacing", body: "Use 8px steps.", source: [] });
    await s.setRuleStatus(rule.slug, "approved");
    const edited = await s.updateRule(rule.slug, { body: "Use 4px steps." });
    expect(edited).toMatchObject({ body: "Use 4px steps.", status: "draft", title: "Spacing" });
    expect(await s.deleteRule(rule.slug)).toBe(true);
    expect(await s.listRules()).toEqual([]);
    expect(await s.deleteRule(rule.slug)).toBe(false);
    expect(await s.updateRule("nope", { body: "x" })).toBeNull();
  });
});

describe("Store across processes", () => {
  it("keeps the same token across restarts", async () => {
    const root = mkdtempSync(join(tmpdir(), "jrabbit-token-"));
    const first = await new Store(root).token();
    expect(first).toMatch(/^[\w-]{32,}$/);
    expect(await new Store(root).token()).toBe(first);
  });

  it("agrees on one token when two servers start at once", async () => {
    const root = mkdtempSync(join(tmpdir(), "jrabbit-token-"));
    const [a, b] = await Promise.all([new Store(root).token(), new Store(root).token()]);
    expect(a).toBe(b);
  });

  it("numbers pins uniquely when two stores share a project", async () => {
    const root = mkdtempSync(join(tmpdir(), "jrabbit-shared-"));
    const a = new Store(root);
    const b = new Store(root);
    const pins = await Promise.all([a, b, a, b].map((s, i) => s.createPin(input(`c${i}`), null, [])));
    expect(pins.map((p) => p.n).sort()).toEqual([1, 2, 3, 4]);
  });

  it("delivers each sent pin to only one agent session", async () => {
    const root = mkdtempSync(join(tmpdir(), "jrabbit-claim-"));
    const a = new Store(root);
    const b = new Store(root);
    const pin = await a.createPin(input("x"), null, []);
    await a.updatePin(pin.id, (p) => a.setStatus(p, "open", "human"));
    const [ca, cb] = await Promise.all([a.claimUndelivered(), b.claimUndelivered()]);
    expect(ca.length + cb.length).toBe(1);
    expect((await a.getPin(pin.id))?.deliveredAt).toBeTruthy();
    expect(await a.claimUndelivered()).toEqual([]);
  });
});

describe("slugify", () => {
  it("makes safe file names", () => {
    expect(slugify("Ñandú: Títulos  grandes!")).toBe("nandu-titulos-grandes");
  });
});
