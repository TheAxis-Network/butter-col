/**
 * The `butter-col` command line.
 *
 *   butter-col server start [options]     run OpenResty (foreground)
 *   butter-col server stop|reload|test    control a running server
 *   butter-col fetch-ca                   download Mozilla's CA bundle
 *   butter-col transport add <pkg|file>   make a transport servable
 *   butter-col transport list
 *   butter-col static <outdir> [options]  build a serverless deployment
 *   butter-col paths                      print package paths as JSON
 */
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createConfigScript,
  createPublicConfig,
  defaultConfigPath,
  distPath,
  findOpenResty,
  luaPath,
  packageRoot,
  renderServerConfig,
  resolveTransport,
  serverPath,
  sitePath,
  transportsPath,
  version,
} from "./index.js";

const HELP = `butter-col ${version}

Usage:
  butter-col server start   [--port 8080] [--site <dir>] [--config <file>] [--runtime .butter]
                            [--transports butter-transports] [--cacert <file>] [--openresty <bin>]
  butter-col server stop|reload|test   (same options)
  butter-col fetch-ca       [--runtime .butter]
  butter-col transport add  <package-or-file> [--name <name>] [--transports butter-transports]
  butter-col transport list [--transports butter-transports]
  butter-col static <outdir> [--config butter.static.json] [--site <dir>] [--transports butter-transports]
  butter-col paths

Defaults:
  --config     ./butter.config.lua if it exists, else the package default
  --site       the package's minimal launcher
  --runtime    ./.butter   (rendered nginx config, logs, cacert.pem, served transports)
  --transports ./butter-transports   (scripts added with "transport add")
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      if (inline !== undefined) flags[key] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[key] = argv[++i];
      else flags[key] = true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const log = (...args) => console.log("[butter-col]", ...args);

function fail(message) {
  console.error(`butter-col: ${message}`);
  process.exit(1);
}

function options(flags) {
  const cwd = process.cwd();
  const runtimeDir = path.resolve(cwd, flags.runtime ?? ".butter");
  const localConfig = path.resolve(cwd, "butter.config.lua");
  return {
    cwd,
    runtimeDir,
    listen: flags.port ?? flags.listen ?? 8080,
    siteRoot: flags.site ? path.resolve(cwd, flags.site) : sitePath,
    configFile: flags.config ? path.resolve(cwd, flags.config) : existsSync(localConfig) ? localConfig : defaultConfigPath,
    transportsDir: path.resolve(cwd, flags.transports ?? "butter-transports"),
    cacert: flags.cacert ? path.resolve(cwd, flags.cacert) : path.join(runtimeDir, "cacert.pem"),
    openresty: flags.openresty ?? findOpenResty(cwd),
  };
}

async function fetchCa(target) {
  const source = "https://curl.se/ca/cacert.pem";
  const res = await fetch(source);
  if (!res.ok) throw new Error(`GET ${source} failed: HTTP ${res.status}`);
  const pem = await res.text();
  const count = (pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
  if (count < 50) throw new Error(`unexpected CA bundle contents (${count} certificates)`);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, pem);
  log(`wrote ${count} certificates to ${path.relative(process.cwd(), target) || target}`);
}

/** Copy built-in and added transports to where nginx serves /butter/transports/. */
function stageTransports(opts) {
  const served = path.join(opts.runtimeDir, "www", "butter", "transports");
  mkdirSync(served, { recursive: true });
  const copied = [];
  for (const dir of [transportsPath, opts.transportsDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!/\.js(\.map)?$/.test(file)) continue;
      copyFileSync(path.join(dir, file), path.join(served, file));
      if (file.endsWith(".js")) copied.push(file.replace(/\.js$/, ""));
    }
  }
  return copied;
}

function prepareRuntime(opts) {
  if (!existsSync(path.join(distPath, "sw.js"))) fail(`${distPath} is missing; build the package first (npm run build)`);
  const confDir = path.join(opts.runtimeDir, "conf");
  mkdirSync(confDir, { recursive: true });
  mkdirSync(path.join(opts.runtimeDir, "logs"), { recursive: true });
  const files = renderServerConfig(opts);
  for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(confDir, name), contents);
  return stageTransports(opts);
}

function runOpenResty(opts, extra) {
  const binary = opts.openresty;
  // Windows builds resolve their bundled lualib/ relative to the working directory.
  const cwd = path.isAbsolute(binary) ? path.dirname(binary) : opts.cwd;
  const args = ["-p", opts.runtimeDir + path.sep, "-c", "conf/nginx.conf", ...extra];
  const child = spawn(binary, args, { cwd, stdio: "inherit" });
  child.on("error", (err) => fail(`could not run ${binary}: ${err.message}. Install OpenResty or pass --openresty <path>.`));
  return child;
}

async function server(command, flags) {
  const opts = options(flags);
  if (command === "stop") {
    runOpenResty(opts, ["-s", "stop"]).on("exit", (code) => process.exit(code ?? 0));
    return;
  }
  if (!["start", "reload", "test"].includes(command)) fail(`unknown server command "${command}"`);
  if (!existsSync(opts.cacert)) {
    log("no CA bundle yet; downloading one");
    await fetchCa(opts.cacert);
  }
  const transports = prepareRuntime(opts);
  if (command === "test") {
    runOpenResty(opts, ["-t"]).on("exit", (code) => process.exit(code ?? 0));
    return;
  }
  if (command === "reload") {
    runOpenResty(opts, ["-s", "reload"]).on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  log(`config     ${opts.configFile}`);
  log(`site       ${opts.siteRoot}`);
  log(`transports ${transports.join(", ")}`);
  log(`listening  http://localhost:${opts.listen}/`);
  const extra = process.platform === "win32" ? [] : ["-g", "daemon off;"];
  const child = runOpenResty(opts, extra);
  const stop = () => runOpenResty(opts, ["-s", "stop"]);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

function transportAdd(specifier, flags) {
  if (!specifier) fail("usage: butter-col transport add <package-or-file>");
  const info = resolveTransport(specifier);
  const name = flags.name ?? info.name;
  const dir = path.resolve(flags.transports ?? "butter-transports");
  mkdirSync(dir, { recursive: true });
  copyFileSync(info.file, path.join(dir, `${name}.js`));
  if (existsSync(info.file + ".map")) copyFileSync(info.file + ".map", path.join(dir, `${name}.js.map`));
  log(`added transport "${name}"${info.packageName ? ` from ${info.packageName}@${info.version}` : ""} → ${path.relative(process.cwd(), dir)}/${name}.js`);
  console.log(`
Offer it in butter.config.lua:

  transports = {
    { name = "butter" },
    { name = "${name}", options = { --[[ see the transport's README ]] } },
  },
`);
}

function transportList(flags) {
  const dir = path.resolve(flags.transports ?? "butter-transports");
  const list = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".js")).map((f) => f.slice(0, -3)) : []);
  console.log(`built in: ${list(transportsPath).join(", ") || "(none)"}`);
  console.log(`added (${path.relative(process.cwd(), dir) || dir}): ${list(dir).join(", ") || "(none)"}`);
}

function buildStatic(outdir, flags) {
  if (!outdir) fail("usage: butter-col static <outdir> [--config butter.static.json]");
  const out = path.resolve(outdir);
  const configPath = path.resolve(flags.config ?? "butter.static.json");
  if (!existsSync(configPath)) fail(`${configPath} not found (see the docs: "Serverless deployments")`);
  const publicConfig = createPublicConfig(JSON.parse(readFileSync(configPath, "utf8")));
  if (publicConfig.transports.some((t) => t.name === "butter")) {
    log('warning: the "butter" transport needs the OpenResty server and will not work in a static deployment');
  }

  const butterDir = path.join(out, "butter");
  mkdirSync(butterDir, { recursive: true });
  cpSync(distPath, butterDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}types`) });
  const transportsDir = path.join(butterDir, "transports");
  const extra = path.resolve(flags.transports ?? "butter-transports");
  if (existsSync(extra)) cpSync(extra, transportsDir, { recursive: true });
  writeFileSync(path.join(butterDir, "config.js"), createConfigScript(publicConfig));

  const site = flags.site ? path.resolve(flags.site) : sitePath;
  cpSync(site, out, { recursive: true, force: false, errorOnExist: false });
  // Static hosts serve 404.html for unknown paths: let it bootstrap /butter/go/ URLs.
  if (!existsSync(path.join(out, "404.html"))) copyFileSync(path.join(distPath, "bootstrap.html"), path.join(out, "404.html"));

  for (const t of publicConfig.transports) {
    const local = t.url.startsWith(publicConfig.base) ? path.join(out, t.url) : null;
    if (local && !existsSync(local)) log(`warning: transport "${t.name}" points at ${t.url}, which is not in the output`);
  }
  log(`static deployment written to ${out}`);
  log("serve it over HTTPS, with Service-Worker-Allowed: / on /butter/sw.js (or register with scope /butter/)");
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, sub, arg] = positional;
  try {
    switch (command) {
      case "server":
        return await server(sub ?? "start", flags);
      case "fetch-ca":
        return await fetchCa(options(flags).cacert);
      case "transport":
        if (sub === "add") return transportAdd(arg, flags);
        if (sub === "list") return transportList(flags);
        return fail('usage: butter-col transport add|list');
      case "static":
        return buildStatic(sub, flags);
      case "paths":
        return console.log(JSON.stringify({ packageRoot, distPath, transportsPath, serverPath, luaPath, sitePath, defaultConfigPath }, null, 2));
      case undefined:
      case "help":
      case "--help":
        return console.log(HELP);
      default:
        if (flags.help || flags.h) return console.log(HELP);
        if (flags.version || flags.v) return console.log(version);
        return fail(`unknown command "${command}"\n\n${HELP}`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}
