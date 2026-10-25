import { getCodec } from "./codecs.js";

/** Marker placed after the prefix for module workers: /butter/go/~m/<encoded> */
export const MODULE_WORKER_MARK = "~m/";

const PASSTHROUGH_SCHEMES = /^(?:data|blob|about|mailto|tel|sms|javascript|intent|chrome|chrome-extension|moz-extension|file|filesystem):/i;
const TARGET_SCHEME = /^(?:https?|wss?):\/\//i;

/**
 * @typedef {object} UrlRewriterOptions
 * @property {string} origin  Proxy origin, e.g. "https://proxy.example"
 * @property {string} prefix  Path prefix for proxied URLs, e.g. "/butter/go/"
 * @property {string} codec   Codec name, see codecs.js
 */

/**
 * @param {UrlRewriterOptions} options
 */
export function createUrlRewriter({ origin, prefix, codec: codecName }) {
  const codec = getCodec(codecName);
  const absPrefix = origin + prefix;

  /**
   * Decode the part of a proxied path that follows the prefix.
   * Returns null when the tail is not a valid encoded URL (for example a
   * relative path that the browser resolved against the proxy URL).
   * @param {string} tail
   * @returns {string | null}
   */
  function decodeTail(tail) {
    if (tail.startsWith(MODULE_WORKER_MARK)) tail = tail.slice(MODULE_WORKER_MARK.length);
    let decoded;
    try {
      decoded = codec.decode(tail);
    } catch {
      return null;
    }
    if (!TARGET_SCHEME.test(decoded)) return null;
    try {
      return new URL(decoded).href;
    } catch {
      return null;
    }
  }

  /**
   * Is this an already rewritten URL (absolute or path-absolute)?
   * @param {string} url
   */
  function isProxied(url) {
    return url.startsWith(absPrefix) || url.startsWith(prefix);
  }

  /**
   * Rewrite a URL found in a page so that it points through the proxy.
   * Non-http(s) URLs and fragment-only references are returned unchanged.
   * @param {string} raw
   * @param {string | URL} base  The target (unproxied) base URL
   * @param {{ moduleWorker?: boolean }} [opts]
   * @returns {string}
   */
  function rewrite(raw, base, opts) {
    if (raw == null) return raw;
    const str = String(raw);
    const trimmed = str.trim();
    if (!trimmed || trimmed.startsWith("#") || PASSTHROUGH_SCHEMES.test(trimmed)) return str;
    if (isProxied(trimmed)) return trimmed;
    let abs;
    try {
      abs = new URL(trimmed, base);
    } catch {
      return str;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return str;
    const hash = abs.hash;
    abs.hash = "";
    const mark = opts && opts.moduleWorker ? MODULE_WORKER_MARK : "";
    return absPrefix + mark + codec.encode(abs.href) + hash;
  }

  /**
   * Turn a proxied URL back into the target URL. Anything that is not a
   * proxied URL is returned unchanged.
   * @param {string} url
   * @returns {string}
   */
  function unrewrite(url) {
    if (url == null) return url;
    const str = String(url);
    let rest;
    if (str.startsWith(absPrefix)) rest = str.slice(absPrefix.length);
    else if (str.startsWith(prefix)) rest = str.slice(prefix.length);
    else return str;

    let hash = "";
    const hashAt = rest.indexOf("#");
    if (hashAt !== -1) {
      hash = rest.slice(hashAt);
      rest = rest.slice(0, hashAt);
    }
    let search = "";
    const searchAt = rest.indexOf("?");
    if (searchAt !== -1) {
      search = rest.slice(searchAt);
      rest = rest.slice(0, searchAt);
    }
    const decoded = decodeTail(rest);
    if (decoded === null) return str;
    if (!search) return decoded + hash;
    const target = new URL(decoded);
    target.search = search;
    return target.href + hash;
  }

  /**
   * @param {string} value  A srcset attribute value
   * @param {string | URL} base
   * @param {(url: string, base: string | URL) => string} [map]
   */
  function rewriteSrcset(value, base, map = rewrite) {
    // Follows the HTML "parse a srcset attribute" algorithm closely enough to
    // keep data: URLs (which contain commas) intact.
    let out = "";
    let i = 0;
    const n = value.length;
    while (i < n) {
      const wsStart = i;
      while (i < n && (/\s/.test(value[i]) || value[i] === ",")) i++;
      out += value.slice(wsStart, i);
      if (i >= n) break;
      const urlStart = i;
      while (i < n && !/\s/.test(value[i])) i++;
      let url = value.slice(urlStart, i);
      let trailing = "";
      const commas = url.match(/,+$/);
      if (commas) {
        trailing = commas[0];
        url = url.slice(0, -trailing.length);
      }
      out += map(url, base) + trailing;
      if (trailing) continue;
      // Descriptors run until the next comma that is not inside parentheses.
      const descStart = i;
      let depth = 0;
      while (i < n) {
        const ch = value[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        else if (ch === "," && depth === 0) break;
        i++;
      }
      out += value.slice(descStart, i);
    }
    return out;
  }

  return {
    origin,
    prefix,
    codec,
    decodeTail,
    isProxied,
    rewrite,
    unrewrite,
    rewriteSrcset,
    unrewriteSrcset: (value) => rewriteSrcset(value, "", (url) => unrewrite(url)),
  };
}

/** @typedef {ReturnType<typeof createUrlRewriter>} UrlRewriter */
