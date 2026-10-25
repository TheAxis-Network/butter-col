/**
 * Document-level APIs: URL, referrer, domain, baseURI, cookie, write().
 */
import { wrapAccessor, wrapMethod } from "../util.js";

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 */
export function hookDocument(core, win) {
  const Doc = win.Document.prototype;
  const unrewriteGetter = {
    get(original) {
      return core.unrewrite(original.call(this));
    },
  };

  wrapAccessor(Doc, "URL", unrewriteGetter);
  wrapAccessor(Doc, "documentURI", unrewriteGetter);
  wrapAccessor(win.Node.prototype, "baseURI", unrewriteGetter);

  wrapAccessor(Doc, "referrer", {
    get(original) {
      const referrer = original.call(this);
      if (!referrer) return referrer;
      const target = core.unrewrite(referrer);
      // Referred by butter-col's own pages (the launcher): no referrer.
      return target === referrer && referrer.startsWith(core.origin) ? "" : target;
    },
  });

  wrapAccessor(Doc, "domain", {
    get() {
      try {
        return new URL(core.documentTargetOf(win)).hostname;
      } catch {
        return "";
      }
    },
    set() {
      // Relaxing document.domain is meaningless when every site shares the proxy origin.
    },
  });

  wrapAccessor(Doc, "cookie", {
    get() {
      return core.cookies.get();
    },
    set(value) {
      core.cookies.set(String(value), core.documentTargetOf(win));
    },
  });

  for (const name of ["write", "writeln"]) {
    wrapMethod(Doc, name, (original) =>
      function (...markup) {
        return original.call(this, core.html(markup.join(""), win));
      });
  }
}
