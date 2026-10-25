import { LOCATION } from "../formatter/index.js";
import { createLocation, createWorkerLocation } from "./location.js";
import { hide, hasOwn, installToString } from "./util.js";
import { installGlobals } from "./hooks/globals.js";
import { hookNetwork } from "./hooks/network.js";
import { hookWindow } from "./hooks/window.js";
import { hookDocument } from "./hooks/document.js";
import { hookDom } from "./hooks/dom.js";
import { hookIndexedDB, hookStorage } from "./hooks/storage.js";

/** Fake locations for windows that must not be patched (see ensureRealm). */
const foreign = new WeakMap();

/**
 * Is `win` a butter-col page of its own (a launcher or frontend embedding the
 * proxied page) rather than proxied content or an about:blank / blob: frame?
 * Those windows only get a fake Location, never the full set of hooks, which
 * would start rewriting the frontend's own requests.
 */
function isForeign(core, win) {
  const href = win.location.href;
  if (/^(?:about|blob):/i.test(href)) return false;
  return core.f.unrewriteUrl(href) === href;
}

/** The runtime state of another same-origin realm, installing it if needed. */
function ensureRealm(core, win) {
  if (hasOwn(win, "__butter$runtime")) return win.__butter$runtime;
  if (win.document && isForeign(core, win)) {
    let state = foreign.get(win);
    if (!state) {
      state = { core, location: createLocation(core, win) };
      foreign.set(win, state);
    }
    return state;
  }
  return install(core, win);
}

/**
 * Rewritten code reads `top.__butter$location`, `parent.__butter$location`...
 * When the proxied page is framed by a butter-col page (the frontend), that
 * ancestor has no runtime, so give it just the accessor.
 */
function exposeToAncestors(core, win) {
  for (let w = win; ; ) {
    let parent;
    try {
      parent = w.parent;
      if (!parent || parent === w) return;
      if (!hasOwn(parent.Object.prototype, LOCATION)) installGlobals(core, parent, (other) => ensureRealm(core, other));
    } catch {
      return; // cross-origin ancestor: nothing to do (or possible)
    }
    w = parent;
  }
}

/**
 * Patch one realm (a window or a worker global scope). Safe to call more
 * than once; a realm that already has a runtime is returned as-is.
 *
 * @param {import("./core.js").Core} core
 * @param {any} win
 * @returns {{ location: object }}
 */
export function install(core, win) {
  if (hasOwn(win, "__butter$runtime")) return win.__butter$runtime;

  const isWindowRealm = !!win.document;
  const runtime = { core, location: /** @type {object} */ (null) };
  hide(win, "__butter$runtime", runtime);
  runtime.location = isWindowRealm ? createLocation(core, win) : createWorkerLocation(core, win);

  const ensure = (other) => ensureRealm(core, other);
  const steps = [
    () => installToString(win),
    () => installGlobals(core, win, ensure),
    () => hookNetwork(core, win),
    () => hookWindow(core, win, ensure),
    () => hookIndexedDB(win),
  ];
  if (isWindowRealm) {
    steps.push(
      () => hookDocument(core, win),
      () => hookDom(core, win, ensure),
      () => hookStorage(core, win),
      () => exposeToAncestors(core, win),
    );
  }
  for (const step of steps) {
    try {
      step();
    } catch (err) {
      // A missing API in one browser must not take the rest of the runtime down.
      console.warn("[butter] hook failed:", err);
    }
  }
  return runtime;
}
