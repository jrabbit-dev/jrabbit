import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  SourceResolver,
  cleanSourcePath,
  isExternalSource,
  lastSourceMappingUrl,
  locateOnDisk,
  parseStack,
  unwrapReactUrl,
} from "../src/server/source.js";

describe("parseStack", () => {
  it("parses named, anonymous and async frames", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at Hero (http://localhost:3000/_next/static/chunks/app_page.js:12:34)",
      "    at async Page (rsc://React/Server/file:///app/.next/server/chunk.js?3:5:6)",
      "    at http://localhost:3000/main.js:1:2",
    ].join("\n");
    expect(parseStack(stack)).toEqual([
      { fn: "Hero", url: "http://localhost:3000/_next/static/chunks/app_page.js", line: 12, column: 34 },
      { fn: "Page", url: "rsc://React/Server/file:///app/.next/server/chunk.js?3", line: 5, column: 6 },
      { url: "http://localhost:3000/main.js", line: 1, column: 2 },
    ]);
  });
});

describe("unwrapReactUrl", () => {
  it("returns the real URL inside rsc:// frames", () => {
    expect(unwrapReactUrl("rsc://React/Server/file:///app/.next/server/chunk.js?3")).toBe("file:///app/.next/server/chunk.js");
    expect(unwrapReactUrl("http://localhost/a.js")).toBe("http://localhost/a.js");
  });
});

describe("cleanSourcePath", () => {
  it.each([
    ["turbopack:///[project]/apps/web/app/page.tsx [app-client] (ecmascript)", "apps/web/app/page.tsx"],
    ["webpack://_N_E/./src/Button.tsx?abc", "src/Button.tsx"],
    ["webpack-internal:///(app-pages-browser)/./app/page.tsx", "app/page.tsx"],
    ["http://localhost:5173/src/App.tsx?t=123", "/src/App.tsx"],
    ["/@fs/Users/me/app/src/x.tsx", "/Users/me/app/src/x.tsx"],
    ["./src/y.ts", "src/y.ts"],
  ])("%s", (input, out) => expect(cleanSourcePath(input)).toBe(out));
});

describe("isExternalSource", () => {
  it("skips dependencies and framework internals", () => {
    expect(isExternalSource("node_modules/react-dom/cjs/x.js")).toBe(true);
    expect(isExternalSource("/app/node_modules/next/dist/client/x.js")).toBe(true);
    expect(isExternalSource("src/components/Button.tsx")).toBe(false);
  });
});

describe("lastSourceMappingUrl", () => {
  it("takes the last reference", () => {
    expect(lastSourceMappingUrl("a\n//# sourceMappingURL=one.map\n//# sourceMappingURL=two.map\n")).toBe("two.map");
    expect(lastSourceMappingUrl("/*# sourceMappingURL=x.css.map */")).toBe("x.css.map");
    expect(lastSourceMappingUrl("nothing")).toBeNull();
  });
});

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jrabbit-src-")));
  mkdirSync(join(root, "src"), { recursive: true });
  return root;
}

describe("locateOnDisk", () => {
  it("finds files relative to the root and drops bundler prefixes", () => {
    const root = project();
    writeFileSync(join(root, "src", "a.tsx"), "");
    expect(locateOnDisk("src/a.tsx", root)).toBe(join(root, "src", "a.tsx"));
    expect(locateOnDisk("apps/web/src/a.tsx", root)).toBe(join(root, "src", "a.tsx"));
    expect(locateOnDisk("src/missing.tsx", root)).toBeNull();
  });
});

describe("SourceResolver", () => {
  const SOURCE = ["export function Button() {", "  return <button className=\"cta\">Buy</button>;", "}", ""].join("\n");

  async function build(root: string) {
    const out = await transform(SOURCE, {
      loader: "tsx",
      jsx: "automatic",
      sourcemap: "external",
      sourcefile: "src/Button.tsx",
    });
    writeFileSync(join(root, "src", "Button.tsx"), SOURCE);
    mkdirSync(join(root, ".next"), { recursive: true });
    writeFileSync(join(root, ".next", "chunk.js"), out.code + "//# sourceMappingURL=chunk.js.map\n");
    writeFileSync(join(root, ".next", "chunk.js.map"), out.map);
    // Find the generated position of the <button> JSX call.
    const lines = out.code.split("\n");
    const line = lines.findIndex((l) => l.includes('"button"'));
    return { code: out.code, line: line + 1, column: lines[line]!.indexOf("jsx") + 1 };
  }

  it("maps a file:// stack frame back to the original line", async () => {
    const root = project();
    const gen = await build(root);
    const resolver = new SourceResolver(root, async () => null);
    const url = pathToFileURL(join(root, ".next", "chunk.js")).href;
    const { source } = await resolver.resolve([
      { stack: `Error\n    at Button (${url}:${gen.line}:${gen.column})` },
      { component: "Button" },
    ]);
    expect(source).toMatchObject({ file: "src/Button.tsx", line: 2, component: "Button" });
  });

  it("maps eval-source-map frames through the dev server", async () => {
    const root = project();
    writeFileSync(join(root, "src", "Button.tsx"), SOURCE);
    const asked: string[] = [];
    const resolver = new SourceResolver(root, async () => null, async (f) => {
      asked.push(f.url);
      return { file: "src/Button.tsx", line: 2, column: 10 };
    });
    const { source } = await resolver.resolve([
      {
        stack: [
          "Error: react-stack-top-frame",
          "    at exports.jsxDEV (webpack-internal:///(app-pages-browser)/../../node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js:333:29)",
          "    at Button (webpack-internal:///(app-pages-browser)/./src/Button.tsx:297:96)",
        ].join("\n"),
      },
    ]);
    expect(source).toMatchObject({ file: "src/Button.tsx", line: 2, column: 10, component: "Button" });
    expect(asked).toEqual(["webpack-internal:///(app-pages-browser)/./src/Button.tsx"]);
  });

  it("resolves sources relative to the map, as Vite writes them", async () => {
    const root = project();
    const out = await transform(SOURCE, { loader: "tsx", jsx: "automatic", sourcemap: "external", sourcefile: "Button.tsx" });
    writeFileSync(join(root, "src", "Button.tsx"), SOURCE);
    writeFileSync(join(root, "src", "Button.gen.js"), out.code + "//# sourceMappingURL=Button.gen.js.map\n");
    writeFileSync(join(root, "src", "Button.gen.js.map"), out.map);
    const lines = out.code.split("\n");
    const line = lines.findIndex((l) => l.includes('"button"'));
    const url = pathToFileURL(join(root, "src", "Button.gen.js")).href;
    const resolver = new SourceResolver(root, async () => null);
    const loc = await resolver.resolveFrame({ fn: "Button", url, line: line + 1, column: lines[line]!.indexOf("jsx") + 1 });
    expect(loc).toMatchObject({ file: "src/Button.tsx", line: 2 });
  });

  it("maps http frames through the fetcher", async () => {
    const root = project();
    const gen = await build(root);
    const { readFileSync } = await import("node:fs");
    const files: Record<string, string> = {
      "http://localhost:3000/_next/chunk.js": readFileSync(join(root, ".next", "chunk.js"), "utf8"),
      "http://localhost:3000/_next/chunk.js.map": readFileSync(join(root, ".next", "chunk.js.map"), "utf8"),
    };
    const resolver = new SourceResolver(root, async (u) => (files[u] ? { body: files[u]! } : null));
    const { source } = await resolver.resolve([
      { stack: `Error\n    at Button (http://localhost:3000/_next/chunk.js:${gen.line}:${gen.column})` },
    ]);
    expect(source).toMatchObject({ file: "src/Button.tsx", line: 2 });
  });

  it("uses _debugSource when present (React 18)", async () => {
    const root = project();
    writeFileSync(join(root, "src", "Old.jsx"), "");
    const resolver = new SourceResolver(root, async () => null);
    const { source } = await resolver.resolve([{ source: { fileName: join(root, "src", "Old.jsx"), lineNumber: 7 } }]);
    expect(source).toMatchObject({ file: "src/Old.jsx", line: 7 });
  });

  it("refuses to read files outside the project", async () => {
    const root = project();
    const resolver = new SourceResolver(root, async () => null);
    const { source } = await resolver.resolve([{ stack: "Error\n    at x (file:///etc/passwd:1:1)" }]);
    expect(source).toBeNull();
  });
});
