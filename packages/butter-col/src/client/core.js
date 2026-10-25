/**
 * Shared state for one runtime: configuration, the formatter, the cookie
 * mirror, and helpers that answer "what is the target URL of this realm?".
 * One core can patch several realms (a page and its about:blank iframes).
 */
import { createTransport } from "@axis-network/butter-transport";
import { createCookieMirror } from "./cookies.js";

/** U+2028 / U+2029 are valid in JSON but end a line in older JS engines. */
const LINE_SEPARATORS = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

/** JSON safe to embed in an inline <script>. */
const scriptJson = (value) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, (ch) => "\\u" + ch.charCodeAt(0).toString(16));

/**
 * @typedef {object} Natives  APIs captured before any hook is installed
 * @property {typeof fetch} fetch
 * @property {typeof WebSocket | undefined} WebSocket
 * @property {() => ServiceWorker | null} controller  the real navigator.serviceWorker.controller
 */

/**
 * @param {import("@axis-network/butter-transport").ButterPublicConfig} config  self.__butter$config
 * @param {import("../formatter/index.js").Formatter} f
 * @param {{ url?: string, cookies?: string, transport?: { name: string, url: string, options?: unknown } }} boot
 * @param {Natives} natives
 */
export function createCore(config, f, boot, natives) {
  /** @type {Promise<import("@axis-network/butter-transport").ButterTransport> | null} */
  let transport = null;
  const selected = boot.transport || { name: config.defaultTransport };

  const core = {
    config,
    f,
    natives,
    /** Proxy origin */
    origin: globalThis.location.origin,
    cookies: createCookieMirror(boot.cookies || "", config.transport.cookie, natives.fetch),
    /** The transport chosen by the service worker for this document or worker. */
    selectedTransport: selected,

    /**
     * This realm's instance of the active transport, created on first use
     * (only WebSockets need one in pages; HTTP goes through the service worker).
     */
    transport() {
      if (!transport) {
        const scope = globalThis.document ? "window" : "worker";
        transport = createTransport(selected.name, selected.options, {
          scope,
          origin: core.origin,
          config,
          fetch: natives.fetch,
          WebSocket: natives.WebSocket,
        });
        transport.catch(() => {
          transport = null;
        });
      }
      return transport;
    },

    /**
     * Ask the service worker something (see the message handler in
     * src/sw/index.ts). Resolves to null when there is no controller.
     */
    askServiceWorker(message, timeout = 3000) {
      const controller = natives.controller();
      if (!controller) return Promise.resolve(null);
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), timeout);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data && event.data.ok ? event.data.result : null);
        };
        controller.postMessage(message, [channel.port2]);
      });
    },

    /** Request headers for a WebSocket handshake to `target`. */
    async socketHeaders(target, win) {
      /** @type {Record<string, string>} */
      const headers = { origin: core.targetOrigin(win) };
      const ua = globalThis.navigator && globalThis.navigator.userAgent;
      if (ua) headers["user-agent"] = ua;
      const reply = await core.askServiceWorker({ type: "butter:socket-cookies", url: target.href });
      if (reply && reply.cookie) headers.cookie = reply.cookie;
      return headers;
    },

    /** Set-Cookie values a transport saw on a WebSocket handshake. */
    storeSocketCookies(target, setCookies) {
      if (setCookies && setCookies.length) {
        core.askServiceWorker({ type: "butter:store-cookies", url: target.href, setCookies: [...setCookies] });
      }
    },

    /** What location.href should report for this realm. */
    hrefOf(win) {
      return f.unrewriteUrl(win.location.href);
    },

    /** Target URL of the document; about:blank / srcdoc frames inherit their parent's. */
    documentTargetOf(win) {
      const href = core.hrefOf(win);
      if (/^(?:about|blob):/i.test(href)) {
        try {
          if (win.parent && win.parent !== win) return core.documentTargetOf(win.parent);
        } catch {
          // cross-origin parent
        }
        if (boot.url) return boot.url;
      }
      return href;
    },

    /** Base URL for resolving relative URLs in this realm (honours <base href>). */
    baseOf(win) {
      return f.unrewriteUrl(win.document ? win.document.baseURI : win.location.href);
    },

    targetOrigin(win) {
      try {
        return new URL(core.documentTargetOf(win)).origin;
      } catch {
        return "null";
      }
    },

    rewrite(url, win, opts) {
      return f.rewriteUrl(String(url), core.baseOf(win), opts);
    },

    unrewrite(url) {
      return f.unrewriteUrl(String(url));
    },

    /** Like rewrite(), but also handles javascript: URLs. */
    rewriteNavigation(url, win) {
      const value = String(url);
      const js = value.match(/^\s*javascript:/i);
      return js ? "javascript:" + f.js(value.slice(js[0].length)) : core.rewrite(value, win);
    },

    /** Rewrite one attribute value of `el`. */
    attr(el, name, value, win) {
      return f.attr(el.localName || "", name, value, {
        base: core.baseOf(win),
        get inject() {
          return core.injection(win);
        },
      });
    },

    /** Rewrite an HTML fragment (innerHTML, document.write, ...). */
    html(markup, win) {
      return f.html(markup, { base: core.baseOf(win) });
    },

    /** Markup that installs the runtime in a new document (iframe srcdoc). */
    injection(win) {
      const bootData = { url: core.documentTargetOf(win), cookies: core.cookies.get(), transport: selected };
      const urls = config.transports.map((t) => t.url);
      if (selected.url && !urls.includes(selected.url)) urls.push(selected.url);
      const transportScripts = urls.map((url) => `<script src="${url.replace(/"/g, "&quot;")}" data-butter></script>`).join("");
      return (
        `<script data-butter>self.__butter$config=${scriptJson(config)};self.__butter$boot=${scriptJson(bootData)};</script>` +
        transportScripts +
        `<script src="${config.client}" data-butter></script>`
      );
    },
  };
  return core;
}

/** @typedef {ReturnType<typeof createCore>} Core */
