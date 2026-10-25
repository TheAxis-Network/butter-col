/**
 * Helpers for patching browser APIs without making the patches obvious.
 */

/** Wrapper function -> original native function, for Function.prototype.toString. */
const disguised = new WeakMap();

/**
 * @template {Function} T
 * @param {T} fake
 * @param {Function} real
 * @returns {T}
 */
export function disguise(fake, real) {
  if (typeof fake === "function" && typeof real === "function") disguised.set(fake, real);
  return fake;
}

/** Make wrappers report the original function's source text. */
export function installToString(win) {
  const proto = win.Function.prototype;
  const original = proto.toString;
  const toString = function toString() {
    return original.call(disguised.get(this) || this);
  };
  disguise(toString, original);
  Object.defineProperty(proto, "toString", { value: toString, writable: true, configurable: true, enumerable: false });
}

/** Find a property descriptor on an object or its prototype chain. */
function findDescriptor(obj, name) {
  for (let o = obj; o; o = Object.getPrototypeOf(o)) {
    const desc = Object.getOwnPropertyDescriptor(o, name);
    if (desc) return [o, desc];
  }
  return [null, null];
}

function copyNameAndLength(fake, real) {
  try {
    Object.defineProperty(fake, "name", { value: real.name, configurable: true });
    Object.defineProperty(fake, "length", { value: real.length, configurable: true });
  } catch {
    // non-configurable in some engines; cosmetic only
  }
}

/**
 * Replace a method: `wrap` receives the original and returns the replacement.
 * @param {object | undefined} obj
 * @param {string} name
 * @param {(original: Function) => Function} wrap
 */
export function wrapMethod(obj, name, wrap) {
  if (!obj) return;
  const [owner, desc] = findDescriptor(obj, name);
  if (!owner || !desc || typeof desc.value !== "function" || !desc.configurable && !desc.writable) return;
  const original = desc.value;
  const fake = wrap(original);
  copyNameAndLength(fake, original);
  disguise(fake, original);
  Object.defineProperty(owner, name, { ...desc, value: fake });
}

/**
 * Replace an accessor. `get` is called with `this` and the original getter;
 * `set` with `this`, the value and the original setter.
 * @param {object | undefined} obj
 * @param {string} name
 * @param {{ get?: (this: any, original: Function) => any, set?: (this: any, value: any, original: Function) => void }} hooks
 */
export function wrapAccessor(obj, name, hooks) {
  if (!obj) return;
  const [owner, desc] = findDescriptor(obj, name);
  if (!owner || !desc || !desc.configurable || (!desc.get && !desc.set)) return;
  const next = { configurable: true, enumerable: desc.enumerable };
  // Object literal accessors give the replacements the native "get x" / "set x" names.
  if (desc.get) {
    const origGet = desc.get;
    next.get = hooks.get
      ? disguise(Object.getOwnPropertyDescriptor({ get [name]() { return hooks.get.call(this, origGet); } }, name).get, origGet)
      : origGet;
  }
  if (desc.set) {
    const origSet = desc.set;
    next.set = hooks.set
      ? disguise(Object.getOwnPropertyDescriptor({ set [name](value) { hooks.set.call(this, value, origSet); } }, name).set, origSet)
      : origSet;
  }
  Object.defineProperty(owner, name, next);
}

/**
 * Replace a constructor with a Proxy that can rewrite its arguments.
 * @param {object} win
 * @param {string} name
 * @param {(args: any[]) => any[]} mapArgs
 */
export function wrapConstructor(win, name, mapArgs) {
  const Original = win[name];
  if (typeof Original !== "function") return;
  const proxy = new Proxy(Original, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, mapArgs(args), newTarget === proxy ? target : newTarget);
    },
  });
  disguise(proxy, Original);
  Object.defineProperty(win, name, { value: proxy, writable: true, configurable: true, enumerable: false });
}

/** Define a hidden, non-enumerable value. */
export function hide(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false });
}

/** `obj === obj.window` without throwing on cross-origin windows. */
export function isWindow(obj) {
  try {
    return obj != null && obj.window === obj;
  } catch {
    return false;
  }
}

export function isDocument(obj) {
  try {
    return obj != null && obj.nodeType === 9 && "defaultView" in obj;
  } catch {
    return false;
  }
}

export const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
