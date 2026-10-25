import { MODULE_WORKER_MARK, type Formatter } from "../formatter/index.js";
import type { ButterConfig } from "./config.js";

export interface Route {
  /** Upstream URL to fetch (no fragment). */
  target: URL;
  /** Target URL of the document or worker that made the request, if known. */
  initiator: URL | null;
  /** The request is for a module worker's main script. */
  moduleWorker: boolean;
}

/** `passthrough`: let the browser handle it. `invalid`: undecodable proxied URL. */
export type RouteResult = Route | "passthrough" | "invalid";

interface Initiator {
  target: URL | null;
  /** The request comes from proxied content (including about:blank frames and blob: workers). */
  proxied: boolean;
}

export function createRouter(scope: ServiceWorkerGlobalScope, config: ButterConfig, f: Formatter) {
  const ownOrigin = scope.location.origin;

  function targetOf(url: string): URL | null {
    const target = f.unrewriteUrl(url);
    if (target === url || !/^https?:/i.test(target)) return null;
    try {
      return new URL(target);
    } catch {
      return null;
    }
  }

  async function initiatorOf(event: FetchEvent): Promise<Initiator> {
    if (event.clientId) {
      const client = await scope.clients.get(event.clientId);
      if (client) {
        const target = targetOf(client.url);
        if (target) return { target, proxied: true };
        // about:blank / about:srcdoc frames and blob: workers created by proxied pages
        return { target: null, proxied: !client.url.startsWith(ownOrigin) };
      }
    }
    const referrer = event.request.referrer;
    if (referrer) {
      const target = targetOf(referrer);
      if (target) return { target, proxied: true };
    }
    return { target: null, proxied: false };
  }

  /**
   * Cheap synchronous check so that requests which certainly do not concern
   * the proxy never pay for respondWith().
   */
  function canSkip(request: Request): boolean {
    const url = new URL(request.url);
    if (url.origin !== ownOrigin) return false;
    if (url.pathname.startsWith(config.prefix)) return false;
    if (url.pathname.startsWith(config.base)) return true;
    // A request from a page without a client id (navigations) is only
    // interesting when it was referred by proxied content.
    return request.mode === "navigate" && (!request.referrer || targetOf(request.referrer) === null);
  }

  async function route(event: FetchEvent): Promise<RouteResult> {
    const url = new URL(event.request.url);

    if (url.origin === ownOrigin) {
      if (url.pathname.startsWith(config.prefix)) {
        const tail = url.pathname.slice(config.prefix.length);
        const moduleWorker = tail.startsWith(MODULE_WORKER_MARK);
        const decoded = f.url.decodeTail(tail);
        if (decoded) {
          const target = new URL(decoded);
          // "?x=1" links and GET forms replace the search of the proxied URL.
          if (url.search) target.search = url.search;
          return { target, initiator: (await initiatorOf(event)).target, moduleWorker };
        }
        // A relative URL resolved against the proxied URL by the browser,
        // e.g. /butter/go/img.png: resolve it against the initiator instead.
        const initiator = await initiatorOf(event);
        if (initiator.target) {
          return { target: new URL(tail + url.search, initiator.target), initiator: initiator.target, moduleWorker: false };
        }
        return "invalid";
      }
      if (url.pathname.startsWith(config.base)) return "passthrough";

      // A path-absolute URL that escaped rewriting, e.g. fetch("/api").
      const initiator = await initiatorOf(event);
      if (initiator.target) {
        return { target: new URL(url.pathname + url.search, initiator.target), initiator: initiator.target, moduleWorker: false };
      }
      return "passthrough";
    }

    // Cross-origin request made by a controlled client: proxy it as-is.
    const initiator = await initiatorOf(event);
    if (!initiator.proxied) return "passthrough";
    const target = new URL(url.href);
    target.hash = "";
    return { target, initiator: initiator.target, moduleWorker: false };
  }

  return { route, canSkip };
}
