/**
 * DOM APIs. Attributes in the DOM always hold rewritten (proxied) URLs;
 * getters hand the page the original URLs and setters rewrite on the way in.
 */
import { URL_ATTRS } from "../../formatter/index.js";
import { wrapAccessor, wrapMethod } from "../util.js";

const URL_PROPERTIES = [
  ["HTMLAnchorElement", "href"], ["HTMLAreaElement", "href"], ["HTMLLinkElement", "href"], ["HTMLBaseElement", "href"],
  ["HTMLImageElement", "src"], ["HTMLScriptElement", "src"], ["HTMLIFrameElement", "src"], ["HTMLFrameElement", "src"],
  ["HTMLEmbedElement", "src"], ["HTMLSourceElement", "src"], ["HTMLTrackElement", "src"], ["HTMLMediaElement", "src"],
  ["HTMLInputElement", "src"], ["HTMLVideoElement", "poster"], ["HTMLFormElement", "action"],
  ["HTMLButtonElement", "formAction"], ["HTMLInputElement", "formAction"], ["HTMLObjectElement", "data"],
  ["HTMLModElement", "cite"], ["HTMLQuoteElement", "cite"],
];
const SRCSET_PROPERTIES = [["HTMLImageElement", "srcset"], ["HTMLSourceElement", "srcset"], ["HTMLLinkElement", "imageSrcset"]];
const READONLY_URL_PROPERTIES = [["HTMLImageElement", "currentSrc"], ["HTMLMediaElement", "currentSrc"]];
const HYPERLINK_PARTS = ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "username", "password"];

/** Attributes renamed so the browser ignores them (see formatter/html.js). */
const RENAMED = { integrity: "data-butter-integrity", sandbox: "data-butter-sandbox" };

/** Attributes that can navigate away from the proxy, watched by the safety net. */
const NAVIGATION_ATTRS = { a: "href", area: "href", form: "action", button: "formaction", input: "formaction", iframe: "src", frame: "src" };
const NAVIGATION_SELECTOR = "a[href],area[href],form[action],button[formaction],input[formaction],iframe[src],frame[src],[integrity],iframe[sandbox]";

const JS_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript))$/i;

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 * @param {(win: any) => unknown} ensure
 */
export function hookDom(core, win, ensure) {
  const ElementProto = win.Element.prototype;
  const getAttr = ElementProto.getAttribute;
  const setAttr = ElementProto.setAttribute;
  const removeAttr = ElementProto.removeAttribute;

  const renamedFor = (el, attr) => (attr === "sandbox" && el.localName !== "iframe" ? undefined : RENAMED[attr]);

  // --- Attributes ---------------------------------------------------------

  wrapMethod(ElementProto, "setAttribute", (original) =>
    function setAttribute(name, value) {
      const attr = String(name).toLowerCase();
      const renamed = renamedFor(this, attr);
      if (renamed) return original.call(this, renamed, value);
      return original.call(this, name, core.attr(this, attr, String(value), win));
    });

  wrapMethod(ElementProto, "getAttribute", (original) =>
    function getAttribute(name) {
      const attr = String(name).toLowerCase();
      const value = original.call(this, name);
      if (value === null) {
        const renamed = renamedFor(this, attr);
        return renamed ? original.call(this, renamed) : null;
      }
      if (attr === "srcset" || attr === "imagesrcset") return core.f.url.unrewriteSrcset(value);
      if (URL_ATTRS.has(attr) || attr === "data") return core.unrewrite(value);
      return value;
    });

  wrapMethod(ElementProto, "setAttributeNS", (original) =>
    function setAttributeNS(ns, name, value) {
      const local = String(name).split(":").pop().toLowerCase();
      return original.call(this, ns, name, local === "href" ? core.attr(this, local, String(value), win) : value);
    });

  // --- Reflected URL properties --------------------------------------------

  for (const [iface, prop] of URL_PROPERTIES) {
    const attr = prop.toLowerCase();
    wrapAccessor(win[iface] && win[iface].prototype, prop, {
      get(original) {
        const raw = getAttr.call(this, attr);
        if (raw === null) return core.unrewrite(original.call(this));
        const target = core.unrewrite(raw);
        if (target !== raw) return target;
        try {
          return new URL(raw.trim(), core.baseOf(win)).href;
        } catch {
          return raw;
        }
      },
      set(value) {
        setAttr.call(this, attr, core.attr(this, attr, String(value), win));
      },
    });
  }

  for (const [iface, prop] of SRCSET_PROPERTIES) {
    const attr = prop.toLowerCase();
    wrapAccessor(win[iface] && win[iface].prototype, prop, {
      get() {
        return core.f.url.unrewriteSrcset(getAttr.call(this, attr) || "");
      },
      set(value) {
        setAttr.call(this, attr, core.attr(this, attr, String(value), win));
      },
    });
  }

  for (const [iface, prop] of READONLY_URL_PROPERTIES) {
    wrapAccessor(win[iface] && win[iface].prototype, prop, {
      get(original) {
        return core.unrewrite(original.call(this));
      },
    });
  }

  for (const iface of ["HTMLAnchorElement", "HTMLAreaElement"]) {
    const proto = win[iface] && win[iface].prototype;
    for (const part of HYPERLINK_PARTS) {
      wrapAccessor(proto, part, {
        get() {
          try {
            return new URL(this.href)[part];
          } catch {
            return "";
          }
        },
        set(value) {
          try {
            const url = new URL(this.href);
            url[part] = value;
            this.href = url.href;
          } catch {
            // invalid href: nothing to update
          }
        },
      });
    }
  }

  for (const iface of ["HTMLScriptElement", "HTMLLinkElement"]) {
    wrapAccessor(win[iface] && win[iface].prototype, "integrity", {
      get() {
        return getAttr.call(this, RENAMED.integrity) || "";
      },
      set(value) {
        setAttr.call(this, RENAMED.integrity, String(value));
      },
    });
  }

  // --- Markup and script text ------------------------------------------------

  const rawText = (el, text) => {
    if (el.localName === "style") return core.f.css(text, core.baseOf(win));
    if (el.localName === "script" && JS_TYPE.test((getAttr.call(el, "type") || "").trim())) return core.f.js(text);
    return null;
  };
  const markup = (el, value) => {
    const text = String(value);
    return rawText(el, text) ?? core.html(text, win);
  };

  for (const proto of [ElementProto, win.ShadowRoot && win.ShadowRoot.prototype]) {
    wrapAccessor(proto, "innerHTML", {
      set(value, original) {
        original.call(this, markup(this, value));
      },
    });
  }
  wrapAccessor(ElementProto, "outerHTML", {
    set(value, original) {
      original.call(this, core.html(String(value), win));
    },
  });
  wrapMethod(ElementProto, "insertAdjacentHTML", (original) =>
    function insertAdjacentHTML(position, value) {
      return original.call(this, position, core.html(String(value), win));
    });
  wrapMethod(ElementProto, "setHTMLUnsafe", (original) =>
    function setHTMLUnsafe(value, ...rest) {
      return original.call(this, markup(this, value), ...rest);
    });
  wrapMethod(win.Range && win.Range.prototype, "createContextualFragment", (original) =>
    function createContextualFragment(value) {
      return original.call(this, core.html(String(value), win));
    });

  const scriptText = {
    set(value, original) {
      const text = String(value);
      original.call(this, this.localName === "script" ? rawText(this, text) ?? text : text);
    },
  };
  wrapAccessor(win.HTMLScriptElement && win.HTMLScriptElement.prototype, "text", scriptText);
  wrapAccessor(win.Node.prototype, "textContent", scriptText);
  wrapAccessor(win.HTMLElement.prototype, "innerText", scriptText);

  // --- Frames: install the runtime into about:blank frames on first access ---

  for (const iface of ["HTMLIFrameElement", "HTMLFrameElement", "HTMLObjectElement"]) {
    const proto = win[iface] && win[iface].prototype;
    wrapAccessor(proto, "contentWindow", {
      get(original) {
        const frame = original.call(this);
        if (frame) {
          try {
            ensure(frame);
          } catch {
            // cross-origin
          }
        }
        return frame;
      },
    });
    wrapAccessor(proto, "contentDocument", {
      get(original) {
        const doc = original.call(this);
        if (doc && doc.defaultView) {
          try {
            ensure(doc.defaultView);
          } catch {
            // cross-origin
          }
        }
        return doc;
      },
    });
  }

  // --- Safety net --------------------------------------------------------------
  // Elements created through paths the hooks cannot see (DOMParser, cloned
  // templates, ...) could navigate straight to the real site. Rewrite the
  // attributes that can navigate before anyone gets to click them.

  const fixElement = (el) => {
    if (getAttr.call(el, "data-butter") !== null) return;
    const attr = NAVIGATION_ATTRS[el.localName];
    if (attr) {
      const value = getAttr.call(el, attr);
      if (value !== null) {
        const rewritten = core.attr(el, attr, value, win);
        if (rewritten !== value) setAttr.call(el, attr, rewritten);
      }
    }
    for (const old of ["integrity", "sandbox"]) {
      const renamed = renamedFor(el, old);
      const value = renamed && getAttr.call(el, old);
      if (renamed && value !== null) {
        removeAttr.call(el, old);
        setAttr.call(el, renamed, value);
      }
    }
  };

  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        fixElement(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        fixElement(node);
        for (const el of node.querySelectorAll(NAVIGATION_SELECTOR)) fixElement(el);
      }
    }
  });
  observer.observe(win.document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "action", "formaction", "src", "integrity", "sandbox"],
  });
}
