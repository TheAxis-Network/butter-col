/**
 * Network APIs: fetch, XHR, WebSocket, EventSource, beacons and workers.
 *
 * Most requests would reach the service worker anyway; rewriting them here
 * makes relative URLs resolve against the target page rather than the proxy
 * URL. WebSockets are reimplemented on top of the active transport.
 */
import { wrapAccessor, wrapConstructor, wrapMethod } from "../util.js";
import { createWebSocketClass } from "../websocket.js";

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 */
export function hookNetwork(core, win) {
  const rewrite = (url) => core.rewrite(url, win);
  const isUrlLike = (input) => typeof input === "string" || (win.URL && input instanceof win.URL);
  const unrewriteGetter = {
    get(original) {
      return core.unrewrite(original.call(this));
    },
  };

  wrapConstructor(win, "Request", (args) => {
    if (isUrlLike(args[0])) args[0] = rewrite(args[0]);
    return args;
  });
  wrapMethod(win, "fetch", (original) =>
    function fetch(input, init) {
      return original.call(this, isUrlLike(input) ? rewrite(input) : input, init);
    });
  wrapAccessor(win.Request && win.Request.prototype, "url", unrewriteGetter);
  wrapAccessor(win.Response && win.Response.prototype, "url", unrewriteGetter);

  const XHR = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
  wrapMethod(XHR, "open", (original) =>
    function open(method, url, ...rest) {
      return original.call(this, method, rewrite(url), ...rest);
    });
  wrapAccessor(XHR, "responseURL", unrewriteGetter);

  wrapConstructor(win, "EventSource", (args) => {
    if (args.length) args[0] = rewrite(args[0]);
    return args;
  });
  wrapAccessor(win.EventSource && win.EventSource.prototype, "url", unrewriteGetter);

  // WebSockets never pass through a service worker: they go through the
  // active transport's connect() instead.
  if (win.WebSocket && win.EventTarget) {
    Object.defineProperty(win, "WebSocket", {
      value: createWebSocketClass(core, win),
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  wrapMethod(win.Navigator && win.Navigator.prototype, "sendBeacon", (original) =>
    function sendBeacon(url, ...rest) {
      return original.call(this, rewrite(url), ...rest);
    });

  const workerArgs = (args) => {
    if (!args.length) return args;
    const url = String(args[0]);
    if (/^\s*(?:blob|data):/i.test(url)) return args;
    const options = args[1];
    const moduleWorker = !!options && typeof options === "object" && options.type === "module";
    args[0] = core.rewrite(url, win, { moduleWorker });
    return args;
  };
  wrapConstructor(win, "Worker", workerArgs);
  wrapConstructor(win, "SharedWorker", workerArgs);

  // Worker realms only.
  wrapMethod(win, "importScripts", (original) =>
    function importScripts(...urls) {
      return original.apply(this, urls.map(rewrite));
    });
}
