/**
 * Builds the header set sent upstream for an intercepted request.
 *
 * Browsers hide or forbid several headers (Cookie, Referer, Origin,
 * Sec-Fetch-*) from service workers, and the ones they would send point at
 * the proxy origin anyway. They are recomputed here as if the target site
 * had been visited directly. Cookie is added by the server from its jar;
 * User-Agent, Accept-Language and Accept-Encoding come from the browser's
 * own request to the transport.
 */
import type { Formatter } from "../formatter/index.js";
import type { Route } from "./route.js";

const SKIP = new Set([
  "host", "cookie", "cookie2", "origin", "referer", "connection", "keep-alive",
  "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding",
  "upgrade", "content-length", "service-worker",
]);

function registrableDomain(host: string): string {
  // Without a public suffix list, approximate with the last two labels.
  if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
  return host.split(".").slice(-2).join(".");
}

function fetchSite(initiator: URL | null, target: URL): string {
  if (!initiator) return "none";
  if (initiator.origin === target.origin) return "same-origin";
  if (initiator.protocol === target.protocol && registrableDomain(initiator.hostname) === registrableDomain(target.hostname)) {
    return "same-site";
  }
  return "cross-site";
}

/** Apply the request's referrer policy as if the referrer were the target page. */
export function computeReferrer(request: Request, target: URL, f: Formatter): URL | null {
  const raw = request.referrer;
  if (!raw || raw === "about:client") return null;
  const unproxied = f.unrewriteUrl(raw);
  if (unproxied === raw) return null;
  let referrer: URL;
  try {
    referrer = new URL(unproxied);
  } catch {
    return null;
  }
  referrer.hash = "";
  referrer.username = "";
  referrer.password = "";
  return referrer;
}

function referrerHeader(policy: ReferrerPolicy, referrer: URL, target: URL): string | null {
  const sameOrigin = referrer.origin === target.origin;
  const downgrade = referrer.protocol === "https:" && target.protocol !== "https:";
  const origin = referrer.origin + "/";
  switch (policy) {
    case "no-referrer":
      return null;
    case "origin":
      return origin;
    case "unsafe-url":
      return referrer.href;
    case "same-origin":
      return sameOrigin ? referrer.href : null;
    case "strict-origin":
      return downgrade ? null : origin;
    case "origin-when-cross-origin":
      return sameOrigin ? referrer.href : origin;
    case "no-referrer-when-downgrade":
      return downgrade ? null : referrer.href;
    default: // strict-origin-when-cross-origin
      return downgrade ? null : sameOrigin ? referrer.href : origin;
  }
}

export function buildRequestHeaders(request: Request, route: Route, f: Formatter): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!SKIP.has(name) && !name.startsWith("x-butter-")) headers[name] = value;
  });

  const referrer = computeReferrer(request, route.target, f);
  if (referrer) {
    const value = referrerHeader(request.referrerPolicy, referrer, route.target);
    if (value) headers["referer"] = value;
  }

  const initiator = route.initiator ?? referrer;
  const unsafeMethod = request.method !== "GET" && request.method !== "HEAD";
  const crossOrigin = !!initiator && initiator.origin !== route.target.origin;
  if (initiator && (unsafeMethod || (request.mode === "cors" && crossOrigin))) {
    headers["origin"] = initiator.origin;
  }

  headers["sec-fetch-dest"] = request.destination || "empty";
  headers["sec-fetch-mode"] = request.mode;
  headers["sec-fetch-site"] = fetchSite(initiator, route.target);
  if (request.mode === "navigate") headers["sec-fetch-user"] = "?1";

  return headers;
}
