// Builds the browser bundles into dist/:
//   dist/sw.js                 service worker (src/sw, TypeScript)
//   dist/client.js             in-page runtime (src/client + src/formatter)
//   dist/controller.mjs        ButterController for launcher pages (ES module)
//   dist/formatter.mjs         formatter as an ES module
//   dist/transports/butter.js  the built-in "butter" transport (classic script)
//   dist/bootstrap.html        page served when the service worker is not active yet
//   dist/types/                .d.ts files for controller.mjs and formatter.mjs
import { build, context } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const watch = process.argv.includes("--watch");

const common = {
  absWorkingDir: root,
  bundle: true,
  sourcemap: true,
  minify: !watch,
  target: ["chrome100", "firefox102", "safari15.4"],
  legalComments: "none",
  logLevel: "info",
};

const targets = [
  { ...common, entryPoints: ["src/sw/index.ts"], outfile: "dist/sw.js", format: "iife" },
  { ...common, entryPoints: ["src/client/index.js"], outfile: "dist/client.js", format: "iife" },
  { ...common, entryPoints: ["src/controller/index.ts"], outfile: "dist/controller.mjs", format: "esm" },
  { ...common, entryPoints: ["src/formatter/index.js"], outfile: "dist/formatter.mjs", format: "esm" },
  { ...common, entryPoints: ["src/transports/butter.ts"], outfile: "dist/transports/butter.js", format: "iife" },
];

await rm(new URL("../dist", import.meta.url), { recursive: true, force: true });
await mkdir(new URL("../dist", import.meta.url), { recursive: true });
await cp(new URL("../src/static", import.meta.url), new URL("../dist", import.meta.url), { recursive: true });

if (watch) {
  for (const options of targets) await (await context(options)).watch();
  console.log("watching for changes…");
} else {
  await Promise.all(targets.map((options) => build(options)));
  // typescript's "exports" hides bin/; resolve it next to its package.json.
  const tsPackage = createRequire(import.meta.url).resolve("typescript/package.json");
  const tsc = fileURLToPath(new URL("bin/tsc", pathToFileURL(tsPackage)));
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.controller.json"], { cwd: root, stdio: "inherit" });
}
