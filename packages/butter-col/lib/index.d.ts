import type { ButterPublicConfig } from "@axis-network/butter-transport";

/** Root of the installed package. */
export declare const packageRoot: string;
/** Built browser files: sw.js, client.js, controller.mjs, formatter.mjs, bootstrap.html, transports/. */
export declare const distPath: string;
/** Built-in transport scripts (dist/transports). */
export declare const transportsPath: string;
/** OpenResty files: conf templates, lua/, default config.lua. */
export declare const serverPath: string;
/** Lua modules (server/lua). */
export declare const luaPath: string;
/** Minimal launcher site, used when no --site is given. */
export declare const sitePath: string;
/** Default server configuration (server/config.lua). */
export declare const defaultConfigPath: string;
export declare const version: string;

export interface StaticTransportEntry {
  name: string;
  /** Defaults to /butter/transports/<name>.js */
  url?: string;
  options?: unknown;
}

export interface StaticConfig {
  /** Default "/butter/go/". */
  prefix?: string;
  /** "none" | "plain" | "xor" | "base64" (default "plain"). */
  codec?: string;
  transports: StaticTransportEntry[];
  /** Default: the first transport. */
  defaultTransport?: string;
}

/** Build the public configuration (/butter/config.js contents) without the Lua server. */
export declare function createPublicConfig(input: StaticConfig): ButterPublicConfig;

/** The JavaScript for /butter/config.js. */
export declare function createConfigScript(publicConfig: ButterPublicConfig): string;

export interface RenderOptions {
  listen?: string | number;
  siteRoot?: string;
  configFile?: string;
  runtimeDir: string;
  cacert: string;
}

/** Render the OpenResty configuration files for a runtime directory. */
export declare function renderServerConfig(options: RenderOptions): {
  "nginx.conf": string;
  "butter-proxy.conf": string;
  "mime.types": string;
};

export interface ResolvedTransport {
  name: string;
  file: string;
  packageName?: string;
  version?: string;
}

/** Locate a transport package's browser script (package.json "butter.transport"). */
export declare function resolveTransport(specifier: string, from?: string): ResolvedTransport;

/** Find an OpenResty binary ($OPENRESTY, .tools/openresty-*, or "openresty"). */
export declare function findOpenResty(cwd?: string): string;
