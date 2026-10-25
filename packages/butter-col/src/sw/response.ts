import type { Formatter } from "../formatter/index.js";
import type { ButterConfig } from "./config.js";
import type { Route } from "./route.js";
import type { TransportResponse } from "@axis-network/butter-transport";
import type { TransportInfo } from "./transports.js";
import { decodeText, withUtf8 } from "./charset.js";

/** U+2028 / U+2029 are valid in JSON but end a line in older JS engines. */
const LINE_SEPARATORS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

/** Response headers that would break or escape the proxy if passed through. */
const DROP = new Set([
  "content-security-policy", "content-security-policy-report-only", "x-webkit-csp", "x-content-security-policy",
  "x-frame-options", "x-xss-protection", "strict-transport-security", "expect-ct", "public-key-pins",
  "cross-origin-opener-policy", "cross-origin-opener-policy-report-only",
  "cross-origin-embedder-policy", "cross-origin-embedder-policy-report-only", "cross-origin-resource-policy",
  "origin-agent-cluster", "document-policy", "clear-site-data", "service-worker-allowed",
  "report-to", "reporting-endpoints", "nel", "alt-svc",
  "set-cookie", "set-cookie2", // handled by the server-side cookie jar
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "trailer",
]);

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
export const DOCUMENT_DESTINATIONS = new Set(["document", "iframe", "frame", "embed", "object"]);

type BodyKind = "html" | "js" | "worker" | "css" | "manifest";

function mimeOf(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function isJsMime(mime: string): boolean {
  return /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(mime) || mime === "text/jscript" || mime === "application/x-javascript";
}

function bodyKind(destination: RequestDestination, mime: string): BodyKind | null {
  const html = mime === "text/html" || mime === "application/xhtml+xml";
  const scriptLike = isJsMime(mime) || mime === "" || mime === "text/plain" || mime === "application/octet-stream";
  if (DOCUMENT_DESTINATIONS.has(destination)) return html || mime === "" ? "html" : null;
  switch (destination) {
    case "script":
    case "audioworklet":
    case "paintworklet":
      return scriptLike ? "js" : null;
    case "worker":
    case "sharedworker":
      return scriptLike ? "worker" : null;
    case "style":
      return mime === "text/css" || mime === "" || mime === "text/plain" ? "css" : null;
    case "manifest":
      return "manifest";
    default:
      return null;
  }
}

function rewriteLinkHeader(value: string, base: URL, f: Formatter): string {
  return value.replace(/<([^>]*)>/g, (_, url: string) => `<${f.rewriteUrl(url, base)}>`);
}

export function rewriteResponseHeaders(pairs: Array<[string, string]>, target: URL, f: Formatter): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) {
    const lower = name.toLowerCase();
    if (DROP.has(lower)) continue;
    try {
      switch (lower) {
        case "location":
        case "content-location":
          headers.append(name, f.rewriteUrl(value, target));
          break;
        case "refresh":
          headers.append(name, f.refresh(value, target.href));
          break;
        case "link":
          headers.append(name, rewriteLinkHeader(value, target, f));
          break;
        default:
          headers.append(name, value);
      }
    } catch {
      // Header values the Fetch API refuses are dropped rather than failing the response.
    }
  }
  return headers;
}

/** JSON safe to embed in an inline <script>. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, (ch) => "\\u" + ch.charCodeAt(0).toString(16));
}

/** Everything the body rewriter needs besides the response itself. */
export interface ProxyContext {
  config: ButterConfig;
  f: Formatter;
  /** Active transport, so pages and workers can open WebSockets through it. */
  transport: TransportInfo;
  /** document.cookie view for documents. */
  documentCookies: string | null;
}

const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

/** Markup injected at the top of every proxied document. */
export function documentInjection(ctx: ProxyContext, target: URL): string {
  const boot = { url: target.href, cookies: ctx.documentCookies ?? "", transport: ctx.transport };
  return (
    `<script data-butter>self.__butter$config=${scriptJson(ctx.config)};self.__butter$boot=${scriptJson(boot)};</script>` +
    transportUrls(ctx).map((url) => `<script src="${escapeAttr(url)}" data-butter></script>`).join("") +
    `<script src="${escapeAttr(ctx.config.client)}" data-butter></script>`
  );
}

/**
 * Every configured transport is loaded (not only the active one) so that
 * transports can wrap or fall back to each other in pages too.
 */
function transportUrls(ctx: ProxyContext): string[] {
  const urls = ctx.config.transports.map((t) => t.url);
  return urls.includes(ctx.transport.url) ? urls : [...urls, ctx.transport.url];
}

/** Code prepended to worker scripts so the runtime is installed before the worker's own code runs. */
function workerPrelude(ctx: ProxyContext, module: boolean): string {
  const boot = `self.__butter$boot=${scriptJson({ transport: ctx.transport })};`;
  const scripts = [ctx.config.config, ...transportUrls(ctx), ctx.config.client].map((s) => JSON.stringify(s));
  if (!module) return `${boot}importScripts(${scripts.join(",")});`;
  // Module imports run before the module body, so the boot data is imported too.
  const bootModule = JSON.stringify("data:text/javascript," + encodeURIComponent(boot));
  return [bootModule, ...scripts].map((s) => `import ${s};`).join("");
}

function rewriteManifest(text: string, base: URL, f: Formatter): string {
  try {
    const manifest = JSON.parse(text);
    for (const key of ["start_url", "scope", "id"]) {
      if (typeof manifest[key] === "string") manifest[key] = f.rewriteUrl(manifest[key], base);
    }
    for (const listKey of ["icons", "screenshots", "shortcuts"]) {
      const list = manifest[listKey];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (item && typeof item.src === "string") item.src = f.rewriteUrl(item.src, base);
        if (item && typeof item.url === "string") item.url = f.rewriteUrl(item.url, base);
      }
    }
    return JSON.stringify(manifest);
  } catch {
    return text;
  }
}

function rewriteBody(kind: BodyKind, text: string, route: Route, ctx: ProxyContext): string {
  const { f } = ctx;
  switch (kind) {
    case "html":
      return f.html(text, { base: route.target.href, inject: documentInjection(ctx, route.target) });
    case "js":
      return f.js(text);
    case "worker": {
      const prelude = workerPrelude(ctx, route.moduleWorker);
      const code = f.js(text);
      // Keep a "use strict" directive in first position.
      const directive = !route.moduleWorker && code.match(/^\s*(['"])use strict\1\s*;?/);
      return directive ? directive[0] + prelude + code.slice(directive[0].length) : prelude + code;
    }
    case "css":
      return f.css(text, route.target);
    case "manifest":
      return rewriteManifest(text, route.target, f);
  }
}

const DEFAULT_MIME: Record<BodyKind, string> = {
  html: "text/html",
  js: "text/javascript",
  worker: "text/javascript",
  css: "text/css",
  manifest: "application/manifest+json",
};

export async function buildResponse(request: Request, route: Route, res: TransportResponse, ctx: ProxyContext): Promise<Response> {
  const headers = rewriteResponseHeaders(res.headers, route.target, ctx.f);
  const nullBody = NULL_BODY_STATUS.has(res.status) || request.method === "HEAD";
  let body: BodyInit | null = nullBody ? null : (res.body as BodyInit | null);

  if (!nullBody && res.body != null) {
    const contentType = headers.get("content-type") || "";
    const kind = bodyKind(request.destination, mimeOf(contentType));
    if (kind) {
      const buffer = await new Response(res.body as BodyInit).arrayBuffer();
      const text = decodeText(buffer, contentType, kind === "html");
      body = rewriteBody(kind, text, route, ctx);
      headers.set("content-type", withUtf8(contentType, DEFAULT_MIME[kind]));
    }
  }

  const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
  return new Response(body, { status, statusText: res.statusText, headers });
}
