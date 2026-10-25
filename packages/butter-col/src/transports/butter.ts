/**
 * The "butter" transport: butter-col's built-in transport, talking to its own
 * OpenResty server over /butter/fetch and /butter/ws.
 *
 * HTTP request:  <method> /butter/fetch
 *                X-Butter-URL: <target>
 *                X-Butter-Headers: <JSON object>
 *                X-Butter-Want-Cookies: 1        (documents)
 * HTTP response: 200 + X-Butter-Status / X-Butter-Status-Text /
 *                X-Butter-Headers (JSON [name, value][]) /
 *                X-Butter-Document-Cookies, body streamed
 * WebSocket:     /butter/ws?url=<target>&origin=<page origin>
 *
 * Cookies live in the server's per-session jar, so meta.cookies is "server".
 */
import {
  registerTransport,
  TransportError,
  TRANSPORT_ERROR_CODES,
  type ButterTransport,
  type HeaderList,
  type TransportEnvironment,
} from "@axis-network/butter-transport";

export interface ButterTransportOptions {
  /** HTTP endpoint (default: config.transport.fetch). Relative to the proxy origin. */
  endpoint?: string;
  /** WebSocket endpoint (default: config.transport.ws). */
  websocket?: string;
}

/** JSON with every non-ASCII character escaped, so it is a valid header value. */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^ -~]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

function parseError(header: string, status: number): TransportError {
  try {
    const parsed = JSON.parse(header) as { code?: string; message?: string };
    return new TransportError(parsed.code || TRANSPORT_ERROR_CODES.ERROR, parsed.message || "Transport error", status);
  } catch {
    return new TransportError(TRANSPORT_ERROR_CODES.ERROR, header, status);
  }
}

export function createButterTransport(options: ButterTransportOptions | undefined, env: TransportEnvironment): ButterTransport {
  const fetchEndpoint = new URL(options?.endpoint ?? env.config.transport.fetch, env.origin).href;
  const wsEndpoint = new URL(options?.websocket ?? env.config.transport.ws, env.origin);
  wsEndpoint.protocol = wsEndpoint.protocol === "https:" ? "wss:" : "ws:";

  return {
    meta: {
      name: "butter",
      version: env.config.version,
      description: "butter-col's built-in transport (OpenResty server).",
      cookies: "server",
      websockets: true,
    },

    async request(req) {
      const headers = new Headers();
      headers.set("X-Butter-URL", req.url.href);
      headers.set("X-Butter-Headers", asciiJson(req.headers));
      if (req.context.wantDocumentCookies) headers.set("X-Butter-Want-Cookies", "1");

      let res: Response;
      try {
        res = await env.fetch(fetchEndpoint, {
          method: req.method,
          headers,
          body: req.body,
          redirect: "manual",
          credentials: "same-origin",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          signal: req.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === "AbortError") throw err;
        throw new TransportError(TRANSPORT_ERROR_CODES.UNREACHABLE, "Could not reach the butter-col server.");
      }

      const error = res.headers.get("X-Butter-Error");
      if (error) throw parseError(error, res.status);

      const status = Number(res.headers.get("X-Butter-Status"));
      if (!status) {
        throw new TransportError(
          TRANSPORT_ERROR_CODES.BAD_RESPONSE,
          `Unexpected response from the transport endpoint (HTTP ${res.status}).`,
        );
      }

      let pairs: HeaderList;
      try {
        const parsed = JSON.parse(res.headers.get("X-Butter-Headers") || "[]");
        pairs = Array.isArray(parsed) ? parsed : [];
      } catch {
        throw new TransportError(TRANSPORT_ERROR_CODES.BAD_RESPONSE, "The transport sent malformed response headers.");
      }

      return {
        status,
        statusText: res.headers.get("X-Butter-Status-Text") || "",
        headers: pairs,
        body: res.body,
        documentCookies: res.headers.get("X-Butter-Document-Cookies"),
      };
    },

    connect(url, protocols, headers, handlers) {
      const NativeWebSocket = env.WebSocket;
      if (!NativeWebSocket) throw new TransportError(TRANSPORT_ERROR_CODES.ERROR, "WebSocket is not available here.");
      const endpoint = new URL(wsEndpoint.href);
      endpoint.searchParams.set("url", url.href);
      if (headers.origin) endpoint.searchParams.set("origin", headers.origin);

      const ws = new NativeWebSocket(endpoint.href, protocols);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => handlers.open(ws.protocol, ws.extensions);
      ws.onmessage = (event) => handlers.message(event.data);
      ws.onerror = () => handlers.error("The butter-col WebSocket tunnel failed.");
      ws.onclose = (event) => handlers.close(event.code, event.reason, event.wasClean);

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

registerTransport<ButterTransportOptions>("butter", createButterTransport);
