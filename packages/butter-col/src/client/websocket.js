/**
 * A WebSocket implementation on top of the active transport's connect().
 *
 * Pages keep using `new WebSocket(url, protocols)`; this class looks and
 * behaves like the native one (readyState, binaryType, on* handlers, events,
 * close codes) while the bytes travel however the transport decides.
 */
import { disguise } from "./util.js";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/**
 * @param {import("./core.js").Core} core
 * @param {any} win
 */
export function createWebSocketClass(core, win) {
  const NativeWebSocket = win.WebSocket;
  /** @type {WeakMap<object, any>} */
  const internals = new WeakMap();
  const state = (ws) => {
    const s = internals.get(ws);
    if (!s) throw new win.TypeError("Illegal invocation");
    return s;
  };
  const isBlob = (value) => value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.size === "number";

  async function connect(ws, s, target, protocols) {
    // Events are dispatched in order, even when a Blob must be converted first.
    const dispatch = (make) => {
      s.queue = s.queue.then(async () => {
        const event = await make();
        if (event) ws.dispatchEvent(event);
      });
    };
    const fail = (message) => {
      if (s.readyState === CLOSED) return;
      console.warn(`[butter] WebSocket to ${s.url} failed: ${message}`);
      s.readyState = CLOSED;
      dispatch(() => new win.Event("error"));
      dispatch(() => new win.CloseEvent("close", { code: 1006, reason: "", wasClean: false }));
    };

    try {
      const transport = await core.transport();
      if (!transport.meta.websockets || typeof transport.connect !== "function") {
        throw new Error(`the "${transport.meta.name}" transport does not support WebSockets`);
      }
      const headers = await core.socketHeaders(target, win);
      if (s.readyState === CLOSED) return;

      s.socket = transport.connect(new URL(target.href), protocols, headers, {
        open(protocol, extensions) {
          if (s.closeRequested) {
            s.socket.close(s.closeRequested.code, s.closeRequested.reason);
            return;
          }
          s.protocol = protocol || "";
          s.extensions = extensions || "";
          dispatch(() => {
            s.readyState = OPEN;
            return new win.Event("open");
          });
        },
        message(data) {
          dispatch(async () => {
            if (s.readyState !== OPEN) return null;
            let value = data;
            if (typeof data !== "string") {
              if (s.binaryType === "arraybuffer" && isBlob(data)) value = await data.arrayBuffer();
              else if (s.binaryType === "blob" && !isBlob(data)) value = new win.Blob([data]);
            }
            return new win.MessageEvent("message", { data: value, origin: new URL(s.url).origin });
          });
        },
        error(message) {
          console.warn(`[butter] WebSocket to ${s.url}: ${message}`);
          dispatch(() => new win.Event("error"));
        },
        close(code, reason, wasClean) {
          if (s.closed) return;
          s.closed = true;
          dispatch(() => {
            s.readyState = CLOSED;
            return new win.CloseEvent("close", { code: code || 1005, reason: reason || "", wasClean: !!wasClean });
          });
        },
        cookies(setCookies) {
          core.storeSocketCookies(target, setCookies);
        },
      });
    } catch (err) {
      fail(String((err && err.message) || err));
    }
  }

  class WebSocket extends win.EventTarget {
    constructor(url, protocols) {
      super();
      if (arguments.length === 0) throw new win.TypeError("Failed to construct 'WebSocket': 1 argument required, but only 0 present.");
      let target;
      try {
        target = new URL(String(url), core.baseOf(win));
      } catch {
        throw new win.DOMException(`Failed to construct 'WebSocket': The URL '${url}' is invalid.`, "SyntaxError");
      }
      if (target.protocol === "http:") target.protocol = "ws:";
      else if (target.protocol === "https:") target.protocol = "wss:";
      if (target.protocol !== "ws:" && target.protocol !== "wss:") {
        throw new win.DOMException(`Failed to construct 'WebSocket': The URL's scheme must be either 'http', 'https', 'ws', or 'wss'. '${target.protocol}' is not allowed.`, "SyntaxError");
      }
      if (target.hash) {
        throw new win.DOMException("Failed to construct 'WebSocket': The URL contains a fragment identifier.", "SyntaxError");
      }
      const list = protocols === undefined ? [] : typeof protocols === "string" ? [protocols] : Array.from(protocols, String);
      if (new Set(list).size !== list.length) {
        throw new win.DOMException("Failed to construct 'WebSocket': The subprotocol is duplicated.", "SyntaxError");
      }

      const s = {
        url: target.href,
        readyState: CONNECTING,
        protocol: "",
        extensions: "",
        binaryType: "blob",
        socket: null,
        closeRequested: null,
        closed: false,
        queue: Promise.resolve(),
        handlers: {},
      };
      internals.set(this, s);
      connect(this, s, target, list);
    }

    get url() { return state(this).url; }
    get readyState() { return state(this).readyState; }
    get protocol() { return state(this).protocol; }
    get extensions() { return state(this).extensions; }
    get bufferedAmount() {
      const s = state(this);
      return (s.socket && s.socket.bufferedAmount) || 0;
    }
    get binaryType() { return state(this).binaryType; }
    set binaryType(value) {
      if (value === "blob" || value === "arraybuffer") state(this).binaryType = value;
    }

    send(data) {
      const s = state(this);
      if (s.readyState === CONNECTING) {
        throw new win.DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", "InvalidStateError");
      }
      if (s.readyState !== OPEN || !s.socket) return;
      s.socket.send(data);
    }

    close(code, reason) {
      const s = state(this);
      if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
        throw new win.DOMException(`Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`, "InvalidAccessError");
      }
      if (reason !== undefined && new TextEncoder().encode(String(reason)).length > 123) {
        throw new win.DOMException("Failed to execute 'close' on 'WebSocket': The close reason must not be greater than 123 UTF-8 bytes.", "SyntaxError");
      }
      if (s.readyState === CLOSING || s.readyState === CLOSED) return;
      const wasConnecting = s.readyState === CONNECTING;
      s.readyState = CLOSING;
      if (wasConnecting && !s.socket) {
        s.closeRequested = { code, reason };
        return;
      }
      if (s.socket) s.socket.close(code, reason === undefined ? undefined : String(reason));
    }
  }

  for (const [name, value] of Object.entries({ CONNECTING, OPEN, CLOSING, CLOSED })) {
    Object.defineProperty(WebSocket, name, { value, enumerable: true });
    Object.defineProperty(WebSocket.prototype, name, { value, enumerable: true });
  }

  // onopen / onmessage / onerror / onclose
  for (const type of ["open", "message", "error", "close"]) {
    Object.defineProperty(WebSocket.prototype, "on" + type, {
      configurable: true,
      enumerable: true,
      get() {
        return state(this).handlers[type]?.handler ?? null;
      },
      set(handler) {
        const s = state(this);
        const previous = s.handlers[type];
        if (previous) this.removeEventListener(type, previous.listener);
        if (typeof handler === "function") {
          const listener = (event) => handler.call(this, event);
          s.handlers[type] = { handler, listener };
          this.addEventListener(type, listener);
        } else {
          delete s.handlers[type];
        }
      },
    });
  }

  Object.defineProperty(WebSocket.prototype, Symbol.toStringTag, { value: "WebSocket", configurable: true });
  if (NativeWebSocket) disguise(WebSocket, NativeWebSocket);
  return WebSocket;
}
