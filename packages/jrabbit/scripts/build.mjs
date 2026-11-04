// Builds dist/cli.js (Node, deps external) and dist/overlay.js (browser IIFE, deps bundled).
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const require = createRequire(import.meta.url);

/** Packages bundled into overlay.js. Their licenses ship in THIRD_PARTY_NOTICES. */
const BUNDLED = ["preact", "modern-screenshot"];

const server = {
  entryPoints: ["src/server/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  sourcemap: true,
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
};

const overlay = {
  entryPoints: ["src/overlay/index.tsx"],
  outfile: "dist/overlay.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  minify: !watch,
  jsx: "automatic",
  jsxImportSource: "preact",
  legalComments: "none",
  banner: { js: `/*! jrabbit overlay ${pkg.version} | MIT | third-party licenses: THIRD_PARTY_NOTICES */` },
  logLevel: "info",
};

async function notices() {
  const parts = ["jrabbit bundles the following third-party software in dist/overlay.js.\n"];
  for (const name of BUNDLED) {
    const dir = dirname(require.resolve(`${name}/package.json`));
    const meta = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    const license = await readFile(join(dir, "LICENSE"), "utf8");
    parts.push(`${"-".repeat(72)}\n${meta.name}@${meta.version} (${meta.license})\n\n${license.trim()}\n`);
  }
  await writeFile("dist/THIRD_PARTY_NOTICES", parts.join("\n"));
}

if (watch) {
  await mkdir("dist", { recursive: true });
  await Promise.all([server, overlay].map(async (o) => (await esbuild.context(o)).watch()));
} else {
  await rm("dist", { recursive: true, force: true });
  await Promise.all([esbuild.build(server), esbuild.build(overlay)]);
  await notices();
}
