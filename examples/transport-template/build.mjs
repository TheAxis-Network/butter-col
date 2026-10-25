// Bundles src/index.js (and the bits of @axis-network/butter-transport it
// uses) into one classic script: dist/logged-transport.js.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/index.js"],
  outfile: "dist/logged-transport.js",
  bundle: true,
  format: "iife", // a classic script: importScripts() and <script> can both load it
  minify: true,
  sourcemap: true,
  target: ["chrome100", "firefox102", "safari15.4"],
  logLevel: "info",
});
