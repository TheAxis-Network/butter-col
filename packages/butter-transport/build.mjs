// Builds dist/index.js and dist/testing.js (ES modules) plus .d.ts files.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
rmSync(new URL("dist", import.meta.url), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts", "src/testing.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: ["es2022"],
  sourcemap: true,
  // testing.js imports the registry from index.js instead of bundling a second copy.
  external: ["./index.js"],
  logLevel: "info",
});

// typescript's "exports" hides bin/; resolve it next to its package.json.
const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
const tsc = new URL("bin/tsc", pathToFileURL(tsPackage));
execFileSync(process.execPath, [fileURLToPath(tsc), "-p", "tsconfig.json"], { cwd: root, stdio: "inherit" });
