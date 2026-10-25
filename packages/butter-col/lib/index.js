/**
 * @axis-network/butter-col: Node API.
 *
 *   import { distPath } from "@axis-network/butter-col";
 *   app.use("/butter/", express.static(distPath));
 *
 * Paths to the built files, helpers to produce /butter/config.js for static
 * deployments, nginx config rendering for the OpenResty server, and transport
 * package resolution. The `butter-col` CLI is built on these.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the installed package. */
export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
/** Built browser files: sw.js, client.js, controller.mjs, formatter.mjs, bootstrap.html, transports/. */
export const distPath = path.join(packageRoot, "dist");
/** Built-in transport scripts (dist/transports). */
export const transportsPath = path.join(distPath, "transports");
/** OpenResty files: conf templates, lua/, default config.lua. */
export const serverPath = path.join(packageRoot, "server");
/** Lua modules (server/lua). */
export const luaPath = path.join(serverPath, "lua");
/** The built-in frontend: served at /app/, and at / when no --site is given. */
export const sitePath = path.join(packageRoot, "site");
/** Default server configuration. */
export const defaultConfigPath = path.join(serverPath, "config.lua");

export const version = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;

const BASE = "/butter/";
const CODECS = ["none", "plain", "xor", "base64"];
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Build the public configuration (what /butter/config.js contains) from a
 * small static description. Used for deployments without the Lua server.
 *
 * @param {{ prefix?: string, codec?: string, transports: Array<{ name: string, url?: string, options?: unknown }>, defaultTransport?: string }} input
 */
export function createPublicConfig(input) {
  const prefix = input.prefix ?? `${BASE}go/`;
  const codec = input.codec ?? "plain";
  if (!prefix.startsWith(BASE) || !prefix.endsWith("/") || prefix === BASE) {
    throw new Error(`prefix must start with ${BASE}, end with "/" and not equal it`);
  }
  if (!CODECS.includes(codec)) throw new Error(`codec must be one of ${CODECS.join(", ")}`);
  if (!Array.isArray(input.transports) || input.transports.length === 0) throw new Error("transports must list at least one transport");

  const seen = new Set();
  const transports = input.transports.map((entry, i) => {
    if (!entry || typeof entry.name !== "string" || !NAME.test(entry.name)) throw new Error(`transports[${i}].name is invalid`);
    if (seen.has(entry.name)) throw new Error(`transport "${entry.name}" is listed twice`);
    seen.add(entry.name);
    const out = { name: entry.name, url: entry.url ?? `${BASE}transports/${entry.name}.js` };
    if (entry.options !== undefined) out.options = entry.options;
    return out;
  });
  const defaultTransport = input.defaultTransport ?? transports[0].name;
  if (!seen.has(defaultTransport)) throw new Error(`defaultTransport "${defaultTransport}" is not in transports`);

  return {
    version,
    prefix,
    base: BASE,
    codec,
    transport: { fetch: `${BASE}fetch`, ws: `${BASE}ws`, cookie: `${BASE}cookie` },
    client: `${BASE}client.js`,
    config: `${BASE}config.js`,
    transports,
    defaultTransport,
  };
}

/** The contents of /butter/config.js for a public configuration. */
export function createConfigScript(publicConfig) {
  return `self.__butter$config = ${JSON.stringify(publicConfig)};\n`;
}

const slash = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * Render the OpenResty configuration files.
 *
 * @param {{ listen?: string | number, siteRoot?: string, configFile?: string, runtimeDir: string, cacert: string }} options
 * @returns {{ "nginx.conf": string, "butter-proxy.conf": string, "mime.types": string }}
 */
export function renderServerConfig(options) {
  const values = {
    LISTEN: String(options.listen ?? 8080),
    LUA_DIR: slash(luaPath),
    CONFIG_FILE: slash(options.configFile ?? defaultConfigPath),
    SITE_ROOT: slash(options.siteRoot ?? sitePath),
    APP_DIR: slash(sitePath),
    DIST_DIR: slash(distPath),
    RUNTIME_DIR: slash(options.runtimeDir),
    CACERT: slash(options.cacert),
  };
  const fill = (template) =>
    template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
      if (!(key in values)) throw new Error(`unknown placeholder ${match}`);
      return values[key];
    });
  const read = (name) => readFileSync(path.join(serverPath, "conf", name), "utf8");
  return {
    "nginx.conf": fill(read("nginx.conf.template")),
    "butter-proxy.conf": fill(read("butter-proxy.conf.template")),
    "mime.types": read("mime.types"),
  };
}

/**
 * Locate a transport's browser script.
 *
 * Transport packages declare it in package.json:
 *   "butter": { "transport": { "name": "bare", "browser": "dist/bare-transport.js" } }
 *
 * @param {string} specifier  package name, or a path to a .js file
 * @param {string} [from]     directory to resolve packages from (default: cwd)
 * @returns {{ name: string, file: string, packageName?: string, version?: string }}
 */
export function resolveTransport(specifier, from = process.cwd()) {
  if (/\.m?js$/.test(specifier) && existsSync(path.resolve(from, specifier))) {
    const file = path.resolve(from, specifier);
    return { name: path.basename(file).replace(/\.m?js$/, "").replace(/-transport$/, ""), file };
  }
  const require = createRequire(path.join(from, "noop.js"));
  let manifestPath;
  try {
    manifestPath = require.resolve(`${specifier}/package.json`);
  } catch {
    throw new Error(`cannot find package "${specifier}" (is it installed?)`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const info = manifest.butter && manifest.butter.transport;
  if (!info || typeof info.name !== "string" || typeof info.browser !== "string") {
    throw new Error(`${specifier} is not a butter-col transport (package.json has no "butter.transport" field)`);
  }
  const file = path.join(path.dirname(manifestPath), info.browser);
  if (!existsSync(file)) throw new Error(`${specifier}: ${info.browser} does not exist (was the package built?)`);
  return { name: info.name, file, packageName: manifest.name, version: manifest.version };
}

/**
 * Find an OpenResty binary: $OPENRESTY, then .tools/openresty-* (Windows zips
 * unpacked there) in `cwd` and its parents, then `openresty` on PATH.
 */
export function findOpenResty(cwd = process.cwd()) {
  if (process.env.OPENRESTY) return process.env.OPENRESTY;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const tools = path.join(dir, ".tools");
    if (existsSync(tools)) {
      const versions = readdirSync(tools).filter((d) => d.startsWith("openresty-")).sort().reverse();
      for (const version of versions) {
        for (const exe of ["nginx.exe", "openresty.exe", "bin/openresty"]) {
          const candidate = path.join(tools, version, exe);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
    if (path.dirname(dir) === dir) break;
  }
  return "openresty";
}
