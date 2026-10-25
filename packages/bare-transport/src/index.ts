/**
 * @axis-network/bare-transport: a butter-col transport for TompHTTP Bare
 * servers (protocol v3), the server type used by Ultraviolet deployments.
 *
 * Spec: https://github.com/tomphttp/specifications/blob/master/BareServerV3.md
 *
 * Bare servers do not keep cookies, so this transport reports
 * meta.cookies = "client" and butter-col keeps the jar in the service worker.
 */
import {
  TransportError,
  TRANSPORT_ERROR_CODES,
  type ButterTransport,
  type HeaderList,
  type TransportEnvironment,
} from "@axis-network/butter-transport";

export interface BareTransportOptions {
  /**
   * The Bare server's root, absolute or relative to the proxy origin,
   * e.g. "https://bare.example.com/" or "/bare/". Requests go to <server>v3/.
   */
  server: string;
}

/** Servers may reject header values longer than this (spec: "Split Headers"). */
export const MAX_HEADER_VALUE = 3072;

/** Error codes from BareServerErrors.md mapped to butter-col's. */
const ERROR_CODES: Record<string, string> = {
  HOST_NOT_FOUND: TRANSPORT_ERROR_CODES.DNS_FAILURE,
  CONNECTION_REFUSED: TRANSPORT_ERROR_CODES.UPSTREAM_UNREACHABLE,
  CONNECTION_RESET: TRANSPORT_ERROR_CODES.UPSTREAM_UNREACHABLE,
  CONNECTION_TIMEOUT: TRANSPORT_ERROR_CODES.UPSTREAM_TIMEOUT,
};

/** Put X-Bare-Headers on `headers`, split into X-Bare-Headers-N parts when long. */
export function setBareHeaders(headers: Headers, json: string): void {
  if (json.length <= MAX_HEADER_VALUE) {
    headers.set("x-bare-headers", json);
    return;
  }
  for (let id = 0, i = 0; i < json.length; id++, i += MAX_HEADER_VALUE) {
    headers.set(`x-bare-headers-${id}`, ";" + json.slice(i, i + MAX_HEADER_VALUE));
  }
}

/** Read X-Bare-Headers, joining X-Bare-Headers-N parts if the server split it. */
export function getBareHeaders(headers: Headers): string | null {
  if (!headers.has("x-bare-headers-0")) return headers.get("x-bare-headers");
  const parts: string[] = [];
  for (let id = 0; headers.has(`x-bare-headers-${id}`); id++) {
    const part = headers.get(`x-bare-headers-${id}`)!;
    if (!part.startsWith(";")) throw new TransportError(TRANSPORT_ERROR_CODES.BAD_RESPONSE, "Malformed split X-Bare-Headers.");
    parts.push(part.slice(1));
  }
  return parts.join("");
}

/** X-Bare-Headers object (values string | string[]) → [name, value] pairs. */
export function bareHeadersToList(object: Record<string, string | string[]>): HeaderList {
  const list: HeaderList = [];
  for (const [name, value] of Object.entries(object)) {
    for (const v of Array.isArray(value) ? value : [value]) list.push([name.toLowerCase(), String(v)]);
  }
  return list;
}

/** JSON with every non-ASCII character escaped, so it is a valid header value. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^ -~]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

async function bareError(res: Response): Promise<TransportError> {
  let code = "UNKNOWN";
  let message = `The Bare server answered HTTP ${res.status}.`;
  try {
    const body = (await res.json()) as { code?: string; id?: string; message?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    else if (body.id) message = `${code} (${body.id})`;
  } catch {
    // not JSON: keep the generic message
  }
  return new TransportError(ERROR_CODES[code] ?? `BARE_${code}`, message, res.status >= 400 ? res.status : 502);
}

export function createBareTransport(options: BareTransportOptions, env: TransportEnvironment): ButterTransport {
  if (!options || typeof options.server !== "string" || !options.server) {
    throw new TypeError('bare-transport: options.server is required, e.g. { server: "https://bare.example.com/" }');
  }
  const root = new URL(options.server.endsWith("/") ? options.server : options.server + "/", env.origin);
  const endpoint = new URL("v3/", root);
  const wsEndpoint = new URL(endpoint.href);
  wsEndpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const userAgent = globalThis.navigator?.userAgent;

  return {
    meta: {
      name: "bare",
      version: "0.1.0",
      description: `TompHTTP Bare v3 server at ${root.href}`,
      cookies: "client",
      websockets: true,
    },

    async request(req) {
      const remoteHeaders: Record<string, string> = { ...req.headers };
      if (userAgent && !remoteHeaders["user-agent"]) remoteHeaders["user-agent"] = userAgent;

      const headers = new Headers();
      headers.set("x-bare-url", req.url.href);
      setBareHeaders(headers, asciiJson(remoteHeaders));

      let res: Response;
      try {
        res = await env.fetch(endpoint.href, {
          method: req.method,
          headers,
          body: req.body,
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: req.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        throw new TransportError(TRANSPORT_ERROR_CODES.UNREACHABLE, `Could not reach the Bare server at ${root.href}.`);
      }

      const status = Number(res.headers.get("x-bare-status"));
      if (!status) {
        if (res.status >= 400) throw await bareError(res);
        throw new TransportError(TRANSPORT_ERROR_CODES.BAD_RESPONSE, "The Bare server sent no X-Bare-Status (is it a Bare v3 server?).");
      }

      let remote: Record<string, string | string[]>;
      try {
        remote = JSON.parse(getBareHeaders(res.headers) ?? "{}");
      } catch {
        throw new TransportError(TRANSPORT_ERROR_CODES.BAD_RESPONSE, "The Bare server sent malformed X-Bare-Headers.");
      }

      return {
        status,
        statusText: res.headers.get("x-bare-status-text") ?? "",
        headers: bareHeadersToList(remote),
        body: res.body,
      };
    },

    connect(url, protocols, headers, handlers) {
      const NativeWebSocket = env.WebSocket;
      if (!NativeWebSocket) throw new TransportError(TRANSPORT_ERROR_CODES.ERROR, "WebSocket is not available here.");
      const remoteHeaders: Record<string, string> = { ...headers };
      if (userAgent && !remoteHeaders["user-agent"]) remoteHeaders["user-agent"] = userAgent;

      const ws = new NativeWebSocket(wsEndpoint.href);
      ws.binaryType = "arraybuffer";
      let open = false;

      ws.onopen = () => {
        // Handshake step 1: a text frame naming the destination.
        ws.send(JSON.stringify({ type: "connect", remote: url.href, protocols, headers: remoteHeaders, forwardHeaders: [] }));
      };
      ws.onmessage = (event) => {
        if (open) {
          handlers.message(event.data);
          return;
        }
        // Handshake step 3: {"type":"open","protocol":"...","setCookies":[...]}
        try {
          if (typeof event.data !== "string") throw new Error("binary frame before open");
          const message = JSON.parse(event.data) as { type?: string; protocol?: string; setCookies?: string[] };
          if (message.type !== "open") throw new Error(`unexpected message type ${message.type}`);
          open = true;
          if (message.setCookies?.length) handlers.cookies?.(message.setCookies);
          handlers.open(message.protocol ?? "", "");
        } catch (err) {
          handlers.error(`Bare WebSocket handshake failed: ${(err as Error).message}`);
          ws.close();
        }
      };
      ws.onerror = () => handlers.error("The Bare WebSocket connection failed.");
      // Bare ignores close codes; report what the tunnel saw.
      ws.onclose = (event) => handlers.close(open ? event.code : 1006, event.reason, open && event.wasClean);

      return {
        send: (data) => ws.send(data as Parameters<WebSocket["send"]>[0]),
        close: (code, reason) => ws.close(code, reason),
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
      };
    },
  };
}

export default createBareTransport;
