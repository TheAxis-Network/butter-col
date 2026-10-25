/**
 * @axis-network/butter-transport: the transport API for butter-col.
 *
 * Transport authors import registerTransport() and the types from here and
 * ship a classic script that registers their factory. butter-col loads that
 * script in the service worker, in proxied pages and in workers, and creates
 * an instance in each realm that needs one.
 */
import type { ButterTransport, TransportEnvironment, TransportFactory } from "./types.js";

export * from "./types.js";
export { TransportError, TRANSPORT_ERROR_CODES } from "./errors.js";
export { headersToList, listToObject, readBody } from "./util.js";

declare global {
  // eslint-disable-next-line no-var
  var __butter$transports: Map<string, TransportFactory> | undefined;
}

/** The registry is a global so separately bundled transports share it. */
function registry(): Map<string, TransportFactory> {
  return (globalThis.__butter$transports ??= new Map());
}

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Register a transport factory under `name`. Call it at the top level of your
 * transport's script.
 *
 * ```js
 * registerTransport("mine", (options, env) => ({ meta: {...}, request(req) {...} }));
 * ```
 */
export function registerTransport<Options>(name: string, factory: TransportFactory<Options>): void {
  if (!NAME.test(name)) throw new TypeError(`butter-transport: invalid transport name "${name}"`);
  if (typeof factory !== "function") throw new TypeError(`butter-transport: factory for "${name}" is not a function`);
  if (registry().has(name)) console.warn(`[butter] transport "${name}" registered twice; the last one wins`);
  registry().set(name, factory as TransportFactory);
}

export function getTransportFactory(name: string): TransportFactory | undefined {
  return registry().get(name);
}

/** Names of every registered transport in this realm. */
export function listTransports(): string[] {
  return [...registry().keys()];
}

/**
 * Create, validate and initialise a transport. Used by butter-col itself;
 * also handy in tests.
 */
export async function createTransport(name: string, options: unknown, env: TransportEnvironment): Promise<ButterTransport> {
  const factory = getTransportFactory(name);
  if (!factory) {
    throw new Error(`butter-transport: no transport named "${name}" is registered (loaded: ${listTransports().join(", ") || "none"})`);
  }
  const transport = await factory(options, env);
  const problems = validateTransport(transport);
  if (problems.length) throw new TypeError(`butter-transport: "${name}" is invalid: ${problems.join("; ")}`);
  if (transport.meta.name !== name) {
    throw new TypeError(`butter-transport: "${name}" reports meta.name "${transport.meta.name}"`);
  }
  await transport.init?.();
  return transport;
}

/** Structural checks; returns a list of problems (empty when valid). */
export function validateTransport(transport: unknown): string[] {
  const problems: string[] = [];
  const t = transport as Partial<ButterTransport> | null;
  if (!t || typeof t !== "object") return ["factory did not return an object"];
  const meta = t.meta;
  if (!meta || typeof meta !== "object") problems.push("meta is missing");
  else {
    if (typeof meta.name !== "string") problems.push("meta.name must be a string");
    if (meta.cookies !== "server" && meta.cookies !== "client") problems.push('meta.cookies must be "server" or "client"');
    if (typeof meta.websockets !== "boolean") problems.push("meta.websockets must be a boolean");
    if (meta.websockets && typeof t.connect !== "function") problems.push("meta.websockets is true but connect() is missing");
  }
  if (typeof t.request !== "function") problems.push("request() is missing");
  if (t.init !== undefined && typeof t.init !== "function") problems.push("init must be a function");
  if (t.destroy !== undefined && typeof t.destroy !== "function") problems.push("destroy must be a function");
  return problems;
}
