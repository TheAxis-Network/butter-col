/// <reference lib="webworker" />
/**
 * butter-col service worker.
 *
 * Registered at /butter/sw.js with scope "/" (the server sends
 * Service-Worker-Allowed: /). It intercepts requests made by proxied pages,
 * sends them through the active transport and rewrites what comes back.
 */
import { TransportError, TRANSPORT_ERROR_CODES, type TransportResponse } from "@axis-network/butter-transport";
import { createFormatter } from "../formatter/index.js";
import { loadConfig } from "./config.js";
import { createRouter, type Route } from "./route.js";
import { buildRequestHeaders } from "./request.js";
import { buildResponse, DOCUMENT_DESTINATIONS } from "./response.js";
import { errorResponse } from "./error-page.js";
import { createTransportManager } from "./transports.js";
import { createCookieStore } from "./cookie-jar.js";

declare const self: ServiceWorkerGlobalScope;

const config = loadConfig(self);
const formatter = createFormatter({ origin: self.location.origin, prefix: config.prefix, codec: config.codec });
const router = createRouter(self, config, formatter);
const transports = createTransportManager(self, config);
const cookies = createCookieStore();

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// --- messages from pages (ButterController, client runtime) ----------------------

type Message =
  | { type: "butter:version" }
  | { type: "butter:get-transport" }
  | { type: "butter:set-transport"; name: string; options?: unknown }
  | { type: "butter:reset-transport" }
  | { type: "butter:socket-cookies"; url: string }
  | { type: "butter:store-cookies"; url: string; setCookies: string[] };

async function handleMessage(message: Message): Promise<unknown> {
  switch (message.type) {
    case "butter:version":
      return { version: config.version };
    case "butter:get-transport":
      return { active: transports.info(await transports.active()), available: transports.list() };
    case "butter:set-transport":
      return { active: await transports.select({ name: message.name, options: message.options }) };
    case "butter:reset-transport":
      return { active: await transports.reset() };
    case "butter:socket-cookies": {
      const { transport } = await transports.active();
      if (transport.meta.cookies !== "client") return { cookie: "" };
      return { cookie: await cookies.header(new URL(message.url)) };
    }
    case "butter:store-cookies": {
      const { transport } = await transports.active();
      if (transport.meta.cookies === "client" && Array.isArray(message.setCookies)) {
        await cookies.store(new URL(message.url), message.setCookies.map(String));
      }
      return { ok: true };
    }
    default:
      throw new Error("Unknown message");
  }
}

/**
 * Changing the transport decides where all of a visitor's traffic goes, so
 * only butter-col's own pages (the launcher) may do it, never proxied ones:
 * a hostile site could otherwise point the visitor at its own backend.
 */
function mayChangeTransport(source: ExtendableMessageEvent["source"]): boolean {
  // Only window/worker clients have a URL; MessagePorts and ServiceWorkers are refused.
  if (!source || !("url" in source) || typeof source.url !== "string") return false;
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    return false;
  }
  return url.origin === self.location.origin && !url.pathname.startsWith(config.prefix) && formatter.unrewriteUrl(source.url) === source.url;
}

self.addEventListener("message", (event) => {
  const message = event.data as Message;
  if (!message || typeof message.type !== "string" || !message.type.startsWith("butter:")) return;
  const reply = (data: unknown) => (event.ports[0] ?? event.source)?.postMessage(data);
  if ((message.type === "butter:set-transport" || message.type === "butter:reset-transport") && !mayChangeTransport(event.source)) {
    reply({ ok: false, error: "Transports can only be changed from butter-col's own pages." });
    return;
  }
  event.waitUntil(
    handleMessage(message).then(
      (result) => reply({ ok: true, result }),
      (err) => reply({ ok: false, error: String((err as Error)?.message ?? err) }),
    ),
  );
});

// --- fetch -------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === config.transport.cookie && event.request.method === "POST") {
    event.respondWith(handleCookieWrite(event.request));
    return;
  }
  if (router.canSkip(event.request)) return;
  event.respondWith(handle(event));
});

/**
 * document.cookie writes: client-cookie transports keep the jar here; for
 * server-cookie transports the request goes on to the server.
 */
async function handleCookieWrite(request: Request): Promise<Response> {
  const { transport } = await transports.active().catch(() => ({ transport: null }));
  if (!transport || transport.meta.cookies !== "client") return fetch(request);
  try {
    const data = (await request.json()) as { url?: unknown; cookie?: unknown };
    if (typeof data.url !== "string" || typeof data.cookie !== "string" || data.cookie.length > 4096) {
      return new Response(null, { status: 400 });
    }
    await cookies.store(new URL(data.url), [data.cookie], { fromScript: true });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 400 });
  }
}

async function handle(event: FetchEvent): Promise<Response> {
  const result = await router.route(event);
  if (result === "passthrough") return fetch(event.request);
  if (result === "invalid") {
    return new Response("butter-col: this URL could not be decoded.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  try {
    return await proxy(event.request, result);
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return Response.error();
    return errorResponse(event.request, result.target, err);
  }
}

function checkResponse(res: TransportResponse | undefined, name: string): TransportResponse {
  if (!res || !Number.isInteger(res.status) || !Array.isArray(res.headers)) {
    throw new TransportError(TRANSPORT_ERROR_CODES.BAD_RESPONSE, `The "${name}" transport returned an invalid response.`);
  }
  return res;
}

async function proxy(request: Request, route: Route): Promise<Response> {
  const active = await transports.active();
  const { transport } = active;
  const clientCookies = transport.meta.cookies === "client";
  const isDocument = DOCUMENT_DESTINATIONS.has(request.destination);

  const headers = buildRequestHeaders(request, route, formatter);
  if (clientCookies) {
    const cookie = await cookies.header(route.target);
    if (cookie) headers["cookie"] = cookie;
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const res = checkResponse(
    await transport.request({
      url: route.target,
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : null,
      signal: request.signal,
      context: {
        destination: request.destination,
        mode: request.mode,
        wantDocumentCookies: isDocument && !clientCookies,
      },
    }),
    active.entry.name,
  );

  let documentCookies: string | null = null;
  if (clientCookies) {
    const setCookies = res.headers.filter(([name]) => name.toLowerCase() === "set-cookie").map(([, value]) => value);
    if (setCookies.length) await cookies.store(route.target, setCookies);
    if (isDocument) documentCookies = await cookies.header(route.target, { forScript: true });
  } else if (isDocument) {
    documentCookies = res.documentCookies ?? "";
  }

  return buildResponse(request, route, res, {
    config,
    f: formatter,
    transport: transports.info(active),
    documentCookies,
  });
}
