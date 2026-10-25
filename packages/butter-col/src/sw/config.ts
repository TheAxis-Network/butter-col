/**
 * Runtime configuration, served as /butter/config.js
 * (`self.__butter$config = {...}`). The Lua server renders it from its
 * config.lua; static deployments get one from `butter-col static`.
 */
import type { ButterPublicConfig } from "@axis-network/butter-transport";

export type ButterConfig = ButterPublicConfig;

declare global {
  // eslint-disable-next-line no-var
  var __butter$config: ButterConfig | undefined;
}

export function loadConfig(scope: ServiceWorkerGlobalScope): ButterConfig {
  const url = new URL("config.js", scope.location.href).href;
  scope.importScripts(url);
  const config = globalThis.__butter$config;
  if (!config) throw new Error(`butter: ${url} did not define __butter$config`);
  if (!Array.isArray(config.transports) || config.transports.length === 0) {
    throw new Error(`butter: ${url} lists no transports`);
  }
  return config;
}
