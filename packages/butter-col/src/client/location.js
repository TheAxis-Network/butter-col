/**
 * Fake Location objects. Rewritten scripts read `__butter$location` instead
 * of `location`; for windows and documents that resolves to one of these.
 */

const PARTS = ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin", "username", "password"];

/**
 * @param {import("./core.js").Core} core
 * @param {Window} win
 */
export function createLocation(core, win) {
  const real = win.location;
  const current = () => new URL(core.hrefOf(win));

  const navigate = (url, method) => {
    const value = String(url);
    const base = core.baseOf(win);
    let next;
    try {
      next = new URL(value, base);
    } catch {
      next = null;
    }
    // Same document, different fragment: let the browser scroll without a reload.
    if (next && next.hash && next.href.split("#")[0] === current().href.split("#")[0]) {
      real.hash = next.hash;
      return;
    }
    real[method](core.rewriteNavigation(value, win));
  };

  class Location {
    get href() {
      return current().href;
    }
    set href(value) {
      navigate(value, "assign");
    }
    assign(url) {
      navigate(url, "assign");
    }
    replace(url) {
      navigate(url, "replace");
    }
    reload() {
      real.reload();
    }
    toString() {
      return current().href;
    }
    get ancestorOrigins() {
      return real.ancestorOrigins;
    }
  }

  for (const part of PARTS) {
    const descriptor = {
      configurable: true,
      enumerable: true,
      get() {
        return current()[part];
      },
    };
    if (part === "hash") {
      descriptor.set = (value) => {
        real.hash = value;
      };
    } else if (part !== "origin") {
      descriptor.set = (value) => {
        const url = current();
        url[part] = value;
        navigate(url.href, "assign");
      };
    }
    Object.defineProperty(Location.prototype, part, descriptor);
  }
  Object.defineProperty(Location.prototype, Symbol.toStringTag, { value: "Location", configurable: true });

  return new Location();
}

/**
 * WorkerLocation equivalent for worker realms.
 * @param {import("./core.js").Core} core
 * @param {WorkerGlobalScope} scope
 */
export function createWorkerLocation(core, scope) {
  const current = () => new URL(core.hrefOf(scope));
  class WorkerLocation {
    get href() {
      return current().href;
    }
    toString() {
      return current().href;
    }
  }
  for (const part of PARTS.slice(0, 8)) {
    Object.defineProperty(WorkerLocation.prototype, part, {
      configurable: true,
      enumerable: true,
      get: () => current()[part],
    });
  }
  Object.defineProperty(WorkerLocation.prototype, Symbol.toStringTag, { value: "WorkerLocation", configurable: true });
  return new WorkerLocation();
}
