// Builds:
//   dist/index.js            ES module: createBareTransport() and helpers (no side effects)
//   dist/bare-transport.js   classic script for browsers: registers the "bare" transport
//   dist/*.d.ts              type declarations
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
rmSync(new URL("dist", import.meta.url), { recursive: true, force: true });

const common = { absWorkingDir: root, bundle: true, sourcemap: true, logLevel: "info" };
await Promise.all([
  build({ ...common, entryPoints: ["src/index.ts"], outfile: "dist/index.js", format: "esm", target: ["es2022"], external: ["@axis-network/butter-transport"] }),
  build({ ...common, entryPoints: ["src/register.ts"], outfile: "dist/bare-transport.js", format: "iife", minify: true, target: ["chrome100", "firefox102", "safari15.4"] }),
]);

// typescript's "exports" hides bin/; resolve it next to its package.json.
const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
const tsc = fileURLToPath(new URL("bin/tsc", pathToFileURL(tsPackage)));
execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "inherit" });
