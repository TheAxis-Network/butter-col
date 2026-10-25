/**
 * Window / global scope APIs: navigation, history, messaging, dynamic code,
 * origin and service worker registration.
 */
import { disguise, isWindow, wrapAccessor, wrapMethod } from "../util.js";

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 * @param {(win: any) => unknown} ensure
 */
export function hookWindow(core, win, ensure) {
  const isWindowRealm = !!win.document;
  const js = (code) => (typeof code === "string" ? core.f.js(code) : code);

  // self.origin
  wrapAccessor(win, "origin", {
    get() {
      return core.targetOrigin(win);
    },
  });

  // Dynamic code: setTimeout("code"), new Function("code").
  for (const name of ["setTimeout", "setInterval"]) {
    wrapMethod(win, name, (original) =>
      function (handler, ...rest) {
        return original.call(this, js(handler), ...rest);
      });
  }
  const NativeFunction = win.Function;
  const mapFunctionArgs = (args) => {
    if (args.length) args[args.length - 1] = core.f.js(String(args[args.length - 1]));
    return args;
  };
  const FunctionProxy = new Proxy(NativeFunction, {
    apply(target, thisArg, args) {
      return Reflect.apply(target, thisArg, mapFunctionArgs(args));
    },
    construct(target, args, newTarget) {
      return Reflect.construct(target, mapFunctionArgs(args), newTarget === FunctionProxy ? target : newTarget);
    },
  });
  disguise(FunctionProxy, NativeFunction);
  Object.defineProperty(win, "Function", { value: FunctionProxy, writable: true, configurable: true, enumerable: false });
  // Keep `(function () {}).constructor === Function` true.
  Object.defineProperty(NativeFunction.prototype, "constructor", { value: FunctionProxy, writable: true, configurable: true, enumerable: false });

  // Service workers: the page must not replace or unregister ours.
  const container = win.ServiceWorkerContainer && win.ServiceWorkerContainer.prototype;
  wrapMethod(container, "register", () =>
    function register() {
      return Promise.reject(new win.DOMException("Service workers are unavailable in proxied pages.", "SecurityError"));
    });
  wrapMethod(container, "getRegistration", () =>
    function getRegistration() {
      return Promise.resolve(undefined);
    });
  wrapMethod(container, "getRegistrations", () =>
    function getRegistrations() {
      return Promise.resolve([]);
    });
  wrapAccessor(container, "controller", {
    get() {
      return null;
    },
  });
  wrapAccessor(container, "ready", {
    get() {
      return new Promise(() => {});
    },
  });

  if (!isWindowRealm) return;

  wrapMethod(win, "open", (original) =>
    function open(url, ...rest) {
      const next = url == null || String(url) === "" ? url : core.rewriteNavigation(url, win);
      const opened = original.call(this, next, ...rest);
      if (opened) {
        try {
          ensure(opened); // about:blank popups are written to directly
        } catch {
          // cross-origin or blocked popup
        }
      }
      return opened;
    });

  const History = win.History && win.History.prototype;
  for (const name of ["pushState", "replaceState"]) {
    wrapMethod(History, name, (original) =>
      function (state, title, url) {
        if (arguments.length < 3) return original.call(this, state, title);
        return original.call(this, state, title, url == null ? url : core.rewrite(url, win));
      });
  }

  const Navigation = win.Navigation && win.Navigation.prototype;
  wrapMethod(Navigation, "navigate", (original) =>
    function navigate(url, ...rest) {
      return original.call(this, core.rewriteNavigation(url, win), ...rest);
    });

  // All proxied frames share the proxy origin, so target origins never match.
  wrapMethod(win, "postMessage", (original) =>
    function postMessage(message, targetOrigin, ...rest) {
      if (typeof targetOrigin === "string" && targetOrigin !== "*") {
        targetOrigin = core.origin;
      } else if (targetOrigin && typeof targetOrigin === "object" && typeof targetOrigin.targetOrigin === "string" && targetOrigin.targetOrigin !== "*") {
        targetOrigin = { ...targetOrigin, targetOrigin: core.origin };
      }
      return original.call(this, message, targetOrigin, ...rest);
    });

  wrapAccessor(win.MessageEvent && win.MessageEvent.prototype, "origin", {
    get(original) {
      const origin = original.call(this);
      if (origin !== core.origin) return origin;
      try {
        const source = this.source;
        if (source && isWindow(source)) return core.targetOrigin(source);
      } catch {
        // fall through
      }
      return core.targetOrigin(win);
    },
  });
}
