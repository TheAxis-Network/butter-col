/**
 * The contract between butter-col and a transport.
 *
 * A transport moves bytes between the proxy and the outside world. butter-col
 * decides *what* to request (URL, method, headers, body) and what to do with
 * the answer; the transport decides *how* the request travels: to butter-col's
 * own Lua server, to a Bare server, over Wisp, straight from the browser...
 */

/** Request headers, one value per name (names are lower-case). */
export type HeaderMap = Record<string, string>;

/** Response headers in arrival order. Repeated names (Set-Cookie!) appear once per value. */
export type HeaderList = Array<[name: string, value: string]>;

/** Where a transport instance is running. */
export type TransportScope = "serviceworker" | "window" | "worker";

/** The public configuration served as /butter/config.js. */
export interface ButterPublicConfig {
  version: string;
  prefix: string;
  base: string;
  codec: string;
  transport: { fetch: string; ws: string; cookie: string };
  client: string;
  config: string;
  /** Transports the deployment offers. */
  transports: TransportEntry[];
  /** Name of the transport used unless the visitor picks another. */
  defaultTransport: string;
}

/** One entry of `config.transports`. */
export interface TransportEntry {
  /** Registered name, e.g. "butter" or "bare". */
  name: string;
  /** Classic script that calls registerTransport(); loaded with importScripts / <script>. */
  url: string;
  /** Options passed to the factory (must be JSON-serialisable). */
  options?: unknown;
}

/**
 * Everything a transport receives besides its options. In page and worker
 * realms butter-col hooks fetch and WebSocket, so transports must use the
 * native ones from here rather than the globals.
 */
export interface TransportEnvironment {
  scope: TransportScope;
  /** Origin of the proxy itself, e.g. "https://proxy.example". */
  origin: string;
  config: ButterPublicConfig;
  /** Unhooked fetch. */
  fetch: typeof fetch;
  /** Unhooked WebSocket constructor (absent in service workers of some browsers). */
  WebSocket?: typeof WebSocket;
}

/** Facts butter-col needs to know about a transport. */
export interface TransportMeta {
  /** Must equal the name it was registered under. */
  name: string;
  version?: string;
  description?: string;
  /**
   * Who keeps cookies:
   * - "server": the backend has its own jar (butter-col's Lua server does).
   *   butter-col sends no Cookie header and ignores Set-Cookie.
   * - "client": butter-col keeps a jar in the service worker (IndexedDB),
   *   adds Cookie to requests and reads Set-Cookie from responses.
   */
  cookies: "server" | "client";
  /** Whether connect() is implemented. */
  websockets: boolean;
}

/** Extra facts about the request, for transports that care. */
export interface TransportRequestContext {
  /** Request.destination of the intercepted request ("" for fetch/XHR). */
  destination: string;
  /** Request.mode of the intercepted request. */
  mode: string;
  /**
   * The request is for a document and butter-col would like the
   * document.cookie view back in TransportResponse.documentCookies.
   * Only meaningful for transports with cookies: "server".
   */
  wantDocumentCookies: boolean;
}

export interface TransportRequest {
  /** Absolute http(s) URL, without fragment. */
  url: URL;
  method: string;
  /** Headers to send upstream (Cookie is included for cookies: "client" transports). */
  headers: HeaderMap;
  /** Request body, null for GET/HEAD. */
  body: ArrayBuffer | null;
  /** Aborted when the page cancels the request. */
  signal?: AbortSignal;
  context: TransportRequestContext;
}

export interface TransportResponse {
  /** Upstream status, 200-599. */
  status: number;
  statusText?: string;
  /** Upstream headers, decoded: no transfer/content encoding left to undo. */
  headers: HeaderList;
  /** Decoded body. */
  body: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null;
  /** document.cookie view, when requested and the transport keeps cookies itself. */
  documentCookies?: string | null;
}

/** Callbacks a transport calls during a WebSocket's life. */
export interface SocketHandlers {
  /** The upstream handshake succeeded. */
  open(protocol: string, extensions: string): void;
  /** A message arrived. Text frames as string, binary frames as ArrayBuffer or Blob. */
  message(data: string | ArrayBuffer | Blob): void;
  /** The connection closed (also called after error()). */
  close(code: number, reason: string, wasClean: boolean): void;
  /** Something went wrong; close() follows. */
  error(message: string): void;
  /**
   * Set-Cookie values received with the handshake, for cookies: "client"
   * transports that can see them (Bare's "setCookies").
   */
  cookies?(setCookies: string[]): void;
}

/** What connect() returns. */
export interface TransportSocket {
  send(data: string | ArrayBuffer | ArrayBufferView | Blob): void;
  close(code?: number, reason?: string): void;
  /** Bytes queued but not yet sent, if the transport can tell. */
  readonly bufferedAmount?: number;
}

export interface ButterTransport {
  readonly meta: TransportMeta;
  /** Called once before first use; may be async (open a connection, load WASM...). */
  init?(): Promise<void> | void;
  /** Perform one HTTP request. Throw TransportError for failures. */
  request(req: TransportRequest): Promise<TransportResponse>;
  /**
   * Open a WebSocket to `url` (ws: or wss:). Required when meta.websockets is
   * true. Must return synchronously; report progress through `handlers`.
   */
  connect?(url: URL, protocols: string[], headers: HeaderMap, handlers: SocketHandlers): TransportSocket;
  /** Release resources (called when the visitor switches transports). */
  destroy?(): void;
}

/** Creates a transport from its options. Runs once per realm that uses it. */
export type TransportFactory<Options = any> = (
  options: Options,
  env: TransportEnvironment,
) => ButterTransport | Promise<ButterTransport>;
