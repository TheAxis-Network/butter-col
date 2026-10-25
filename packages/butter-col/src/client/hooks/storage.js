/**
 * Every proxied site shares the proxy origin, and with it one localStorage.
 * Give each target origin its own key namespace so sites don't collide.
 */
import { disguise, wrapMethod } from "../util.js";

function scopeStorage(win, storage, prefix) {
  const proto = win.Storage.prototype;
  const { getItem, setItem, removeItem, key } = proto;

  const keys = () => {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
      const k = key.call(storage, i);
      if (k !== null && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  };

  const api = Object.create(proto, {
    getItem: { value: (k) => getItem.call(storage, prefix + k) },
    setItem: { value: (k, v) => setItem.call(storage, prefix + k, String(v)) },
    removeItem: { value: (k) => removeItem.call(storage, prefix + k) },
    clear: { value: () => keys().forEach((k) => removeItem.call(storage, prefix + k)) },
    key: { value: (i) => keys()[i] ?? null },
    length: { get: () => keys().length },
  });
  for (const name of ["getItem", "setItem", "removeItem", "clear", "key"]) disguise(api[name], proto[name]);

  const isItem = (target, prop) => typeof prop === "string" && !(prop in target);

  return new Proxy(api, {
    get(target, prop) {
      if (isItem(target, prop)) {
        const value = api.getItem(prop);
        return value === null ? undefined : value;
      }
      return Reflect.get(target, prop);
    },
    set(target, prop, value) {
      if (isItem(target, prop)) {
        api.setItem(prop, value);
        return true;
      }
      return Reflect.set(target, prop, value);
    },
    deleteProperty(target, prop) {
      if (isItem(target, prop)) api.removeItem(prop);
      return true;
    },
    has(target, prop) {
      return prop in target || (typeof prop === "string" && api.getItem(prop) !== null);
    },
    ownKeys() {
      return keys();
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop !== "string") return undefined;
      const value = api.getItem(prop);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

/**
 * @param {import("../core.js").Core} core
 * @param {any} win
 */
export function hookStorage(core, win) {
  if (!win.Storage) return;
  const prefix = `butter:${core.targetOrigin(win)}:`;
  for (const name of ["localStorage", "sessionStorage"]) {
    const desc = Object.getOwnPropertyDescriptor(win, name);
    if (!desc || !desc.configurable || !desc.get) continue;
    let storage;
    try {
      storage = desc.get.call(win);
    } catch {
      continue; // storage disabled
    }
    if (!storage) continue;
    const scoped = scopeStorage(win, storage, prefix);
    Object.defineProperty(win, name, {
      configurable: true,
      enumerable: desc.enumerable,
      get: disguise(Object.getOwnPropertyDescriptor({ get [name]() { return scoped; } }, name).get, desc.get),
    });
  }
}

/** The service worker's own database: cookies of "client" transports, the transport choice. */
const RESERVED_DB = "butter-col";
const PAGE_ALIAS = "butter-col (page)";

/**
 * Proxied pages share the proxy origin with the service worker, so they
 * could open its IndexedDB and read every cookie (HttpOnly included).
 * Page code asking for that name gets a separate database instead, and the
 * real one is left out of indexedDB.databases().
 */
export function hookIndexedDB(win) {
  const proto = win.IDBFactory && win.IDBFactory.prototype;
  if (!proto) return;
  for (const method of ["open", "deleteDatabase"]) {
    wrapMethod(proto, method, (original) =>
      function (name, ...rest) {
        return original.call(this, String(name) === RESERVED_DB ? PAGE_ALIAS : name, ...rest);
      });
  }
  wrapMethod(proto, "databases", (original) =>
    function databases() {
      return original.call(this).then((list) =>
        list
          .filter((db) => db.name !== RESERVED_DB)
          .map((db) => (db.name === PAGE_ALIAS ? { ...db, name: RESERVED_DB } : db)));
    });
}
