/**
 * Transport management in the service worker: loads every transport listed
 * in the configuration, remembers which one the visitor picked (IndexedDB),
 * and hands out the active instance.
 */
import {
  createTransport,
  getTransportFactory,
  type ButterPublicConfig,
  type ButterTransport,
  type TransportEntry,
} from "@axis-network/butter-transport";
import { kv } from "./cookie-jar.js";

export interface TransportSelection {
  name: string;
  /** Visitor-supplied options; when absent the configured options apply. */
  options?: unknown;
}

export interface ActiveTransport {
  transport: ButterTransport;
  entry: TransportEntry;
  options: unknown;
}

/** What pages are told about a transport (sent in boot data and to the controller). */
export interface TransportInfo {
  name: string;
  url: string;
  options: unknown;
}

export function createTransportManager(scope: ServiceWorkerGlobalScope, config: ButterPublicConfig) {
  // importScripts only works while the worker script is evaluating, so every
  // configured transport is loaded up front; the visitor can switch among them.
  for (const entry of config.transports) {
    try {
      scope.importScripts(new URL(entry.url, scope.location.href).href);
    } catch (err) {
      console.error(`[butter] could not load transport "${entry.name}" from ${entry.url}:`, err);
    }
  }

  const env = {
    scope: "serviceworker" as const,
    origin: scope.location.origin,
    config,
    fetch: scope.fetch.bind(scope),
    WebSocket: (scope as unknown as { WebSocket?: typeof WebSocket }).WebSocket,
  };

  const entryFor = (name: string) => config.transports.find((e) => e.name === name);
  let selection: TransportSelection | null = null;
  let current: Promise<ActiveTransport> | null = null;

  async function loadSelection(): Promise<TransportSelection> {
    if (selection) return selection;
    const stored = await kv.get<TransportSelection>("transport").catch(() => undefined);
    selection = stored && entryFor(stored.name) ? stored : { name: config.defaultTransport };
    return selection;
  }

  async function start(): Promise<ActiveTransport> {
    const sel = await loadSelection();
    const entry = entryFor(sel.name) ?? entryFor(config.defaultTransport) ?? config.transports[0];
    if (!entry) throw new Error("butter: no transports are configured");
    const options = sel.options !== undefined ? sel.options : entry.options;
    const transport = await createTransport(entry.name, options, env);
    return { transport, entry, options };
  }

  function active(): Promise<ActiveTransport> {
    if (!current) {
      current = start();
      current.catch(() => {
        current = null; // retry on the next request
      });
    }
    return current;
  }

  async function select(next: TransportSelection): Promise<TransportInfo> {
    if (!entryFor(next.name)) throw new Error(`Transport "${next.name}" is not offered by this deployment.`);
    if (!getTransportFactory(next.name)) throw new Error(`Transport "${next.name}" failed to load.`);
    const previous = current;
    selection = { name: next.name, options: next.options };
    current = null;
    const started = await active(); // fail before persisting a broken choice
    await kv.set("transport", selection);
    previous?.then((p) => p.transport.destroy?.()).catch(() => {});
    return info(started);
  }

  async function reset(): Promise<TransportInfo> {
    const previous = current;
    selection = { name: config.defaultTransport };
    current = null;
    await kv.set("transport", undefined);
    previous?.then((p) => p.transport.destroy?.()).catch(() => {});
    return info(await active());
  }

  const info = (a: ActiveTransport): TransportInfo => ({ name: a.entry.name, url: a.entry.url, options: a.options });

  function list() {
    return config.transports.map((e) => ({ name: e.name, url: e.url, loaded: !!getTransportFactory(e.name) }));
  }

  return { active, select, reset, list, info };
}

export type TransportManager = ReturnType<typeof createTransportManager>;
