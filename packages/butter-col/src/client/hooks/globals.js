/**
 * Globals that rewritten code calls into, and the `__butter$location`
 * accessor on Object.prototype.
 */
import { LOCATION, EVAL_WRAP, UNREWRITE } from "../../formatter/index.js";
import { hide, isWindow, isDocument } from "../util.js";

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 * @param {(win: any) => { location: object }} ensure
 */
export function installGlobals(core, win, ensure) {
  hide(win, EVAL_WRAP, (code) => (typeof code === "string" ? core.f.js(code) : code));
  hide(win, UNREWRITE, (url) => core.unrewrite(url));

  const isWorkerScope = (obj) => typeof win.WorkerGlobalScope === "function" && obj instanceof win.WorkerGlobalScope;

  const locationOfWindow = (w) => {
    try {
      return ensure(w).location;
    } catch {
      return w.location; // cross-origin window: the real Location is all there is
    }
  };

  Object.defineProperty(win.Object.prototype, LOCATION, {
    configurable: true,
    enumerable: false,
    get() {
      if (isWindow(this)) return locationOfWindow(this);
      if (isDocument(this)) return this.defaultView ? locationOfWindow(this.defaultView) : null;
      if (isWorkerScope(this)) return ensure(this).location;
      return this.location;
    },
    set(value) {
      if (isWindow(this)) {
        const loc = locationOfWindow(this);
        if (loc === this.location) this.location = value;
        else loc.href = value;
      } else if (isDocument(this) && this.defaultView) {
        locationOfWindow(this.defaultView).href = value;
      } else {
        this.location = value;
      }
    },
  });
}
