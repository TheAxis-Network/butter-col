/**
 * Cookie jar for transports with meta.cookies === "client" (Bare, Wisp-style
 * transports, ...): a port of server/lua/butter/cookiejar.lua, kept in the
 * service worker and persisted to IndexedDB.
 *
 * Transports with meta.cookies === "server" (the built-in "butter" transport)
 * never touch this; their backend keeps the jar.
 */

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  /** Expiry in ms since the epoch; absent for session cookies. */
  expires?: number;
  created: number;
}

interface Target {
  host: string;
  path: string;
  secure: boolean;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function target(url: URL): Target {
  return {
    host: url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
    path: url.pathname || "/",
    secure: url.protocol === "https:" || url.protocol === "wss:",
  };
}

/** RFC 6265 section 5.1.1 date parsing; returns ms since the epoch. */
export function parseCookieDate(value: string): number | null {
  let hour: number | undefined, minute = 0, second = 0, day: number | undefined, month: number | undefined, year: number | undefined;
  for (const token of value.split(/[\s,;\-/]+/)) {
    if (!token) continue;
    const time = token.match(/^(\d\d?):(\d\d?):(\d\d?)/);
    if (time && hour === undefined) {
      hour = Number(time[1]);
      minute = Number(time[2]);
      second = Number(time[3]);
    } else if (day === undefined && /^\d\d?$/.test(token)) {
      day = Number(token);
    } else if (month === undefined && MONTHS[token.slice(0, 3).toLowerCase()]) {
      month = MONTHS[token.slice(0, 3).toLowerCase()];
    } else if (year === undefined && /^\d{2,4}$/.test(token)) {
      year = Number(token);
    }
  }
  if (hour === undefined || day === undefined || month === undefined || year === undefined) return null;
  if (year >= 70 && year <= 99) year += 1900;
  else if (year < 70) year += 2000;
  if (day < 1 || day > 31 || year < 1601 || hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function defaultPath(path: string): string {
  if (!path.startsWith("/")) return "/";
  const last = path.lastIndexOf("/");
  return last <= 0 ? "/" : path.slice(0, last);
}

const isIp = (host: string) => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");

export function domainMatch(host: string, domain: string): boolean {
  if (host === domain) return true;
  if (isIp(host)) return false;
  return host.length > domain.length && host.endsWith("." + domain);
}

export function pathMatch(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

/** Parse one Set-Cookie value received from `url`. */
export function parseSetCookie(header: string, url: URL, now: number): Cookie | null {
  const t = target(url);
  const semi = header.indexOf(";");
  const pair = semi === -1 ? header : header.slice(0, semi);
  const attrs = semi === -1 ? "" : header.slice(semi);
  const eq = pair.indexOf("=");
  const name = eq === -1 ? "" : pair.slice(0, eq).trim();
  const value = eq === -1 ? pair.trim() : pair.slice(eq + 1).trim();
  if (!name && !value) return null;
  if (name.length + value.length > 4096) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name + value)) return null;

  const cookie: Cookie = { name, value, domain: t.host, hostOnly: true, path: "/", secure: false, httpOnly: false, created: now };
  let maxAge: number | undefined;
  let expires: number | undefined;
  let domain: string | undefined;
  let path: string | undefined;
  for (const attr of attrs.split(";").slice(1)) {
    const at = attr.indexOf("=");
    const key = (at === -1 ? attr : attr.slice(0, at)).trim().toLowerCase();
    const val = at === -1 ? "" : attr.slice(at + 1).trim();
    if (key === "expires") expires = parseCookieDate(val) ?? expires;
    else if (key === "max-age" && /^-?\d+$/.test(val)) maxAge = Number(val);
    else if (key === "domain" && val) domain = val.replace(/^\./, "").toLowerCase();
    else if (key === "path" && val.startsWith("/")) path = val;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite") cookie.sameSite = val.toLowerCase();
  }

  if (maxAge !== undefined) cookie.expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  else if (expires !== undefined) cookie.expires = expires;

  if (domain) {
    if (!domainMatch(t.host, domain)) return null;
    if (domain !== t.host && !domain.includes(".")) return null; // "com", "localhost"
    cookie.domain = domain;
    cookie.hostOnly = false;
  }
  cookie.path = path ?? defaultPath(t.path);

  if (cookie.secure && !t.secure) return null;
  if (name.startsWith("__Secure-") && !cookie.secure) return null;
  if (name.startsWith("__Host-") && !(cookie.secure && cookie.hostOnly && cookie.path === "/")) return null;
  return cookie;
}

export interface UpsertOptions {
  /** From document.cookie: may not create or overwrite HttpOnly cookies. */
  fromScript?: boolean;
  max?: number;
}

export function upsert(list: Cookie[], cookie: Cookie, now: number, opts: UpsertOptions = {}): Cookie[] {
  if (opts.fromScript && cookie.httpOnly) return list;
  const out: Cookie[] = [];
  let created: number | undefined;
  for (const c of list) {
    if (c.expires !== undefined && c.expires <= now) continue;
    if (c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path) {
      if (opts.fromScript && c.httpOnly) return list;
      created = c.created;
      continue;
    }
    out.push(c);
  }
  cookie.created = created ?? now;
  if (!(cookie.expires !== undefined && cookie.expires <= now)) out.push(cookie);
  const max = opts.max ?? 3000;
  if (out.length > max) {
    out.sort((a, b) => b.created - a.created);
    out.length = max;
  }
  return out;
}

export function cookieHeader(list: Cookie[], url: URL, now: number, opts: { forScript?: boolean } = {}): string {
  const t = target(url);
  return list
    .filter((c) =>
      !(c.expires !== undefined && c.expires <= now) &&
      (c.hostOnly ? c.domain === t.host : domainMatch(t.host, c.domain)) &&
      pathMatch(t.path, c.path) &&
      (!c.secure || t.secure) &&
      !(opts.forScript && c.httpOnly))
    .sort((a, b) => b.path.length - a.path.length || a.created - b.created)
    .map((c) => (c.name ? `${c.name}=${c.value}` : c.value))
    .join("; ");
}

// --- persistence ----------------------------------------------------------------

const DB_NAME = "butter-col";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Tiny key-value store shared by the cookie jar and the transport settings. */
export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

/** The service worker's jar: an in-memory list mirrored to IndexedDB. */
export function createCookieStore() {
  let list: Promise<Cookie[]> = kv.get<Cookie[]>("cookies").then((v) => v ?? [], () => []);
  let writes = Promise.resolve();

  const save = (next: Cookie[]) => {
    writes = writes.then(() => kv.set("cookies", next)).catch((err) => console.warn("[butter] could not save cookies", err));
  };

  return {
    async header(url: URL, opts?: { forScript?: boolean }): Promise<string> {
      return cookieHeader(await list, url, Date.now(), opts);
    },
    async store(url: URL, setCookies: string[], opts?: UpsertOptions): Promise<void> {
      // Chain updates so concurrent responses can't overwrite each other.
      list = list.then((current) => {
        const now = Date.now();
        for (const value of setCookies) {
          const cookie = parseSetCookie(value, url, now);
          if (cookie) current = upsert(current, cookie, now, opts);
        }
        save(current);
        return current;
      });
      await list;
    },
  };
}
