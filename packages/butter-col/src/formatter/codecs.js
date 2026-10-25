/**
 * URL codecs. A codec turns an absolute target URL (without its fragment)
 * into the string that follows the proxy prefix, and back again.
 *
 * Every codec must satisfy: decode(encode(url)) === url.
 */

/** @typedef {{ encode(url: string): string, decode(encoded: string): string }} Codec */

/** Structure preserving: /butter/go/https://example.com/a/b?c */
const none = {
  encode: (url) => url,
  decode: (encoded) => encoded,
};

/** encodeURIComponent of the whole URL (same idea as Scramjet's "plain"). */
const plain = {
  encode: (url) => encodeURIComponent(url),
  decode: (encoded) => decodeURIComponent(encoded),
};

/** XOR every second character with 2 (same scheme as Ultraviolet). */
function xorString(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += i % 2 ? String.fromCharCode(str.charCodeAt(i) ^ 2) : str[i];
  }
  return out;
}

const xor = {
  encode: (url) => encodeURIComponent(xorString(url)),
  decode: (encoded) => xorString(decodeURIComponent(encoded)),
};

/** URL-safe base64 of the UTF-8 bytes, without padding. */
const base64 = {
  encode(url) {
    const bytes = new TextEncoder().encode(url);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(encoded) {
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  },
};

/** @type {Record<string, Codec>} */
export const codecs = { none, plain, xor, base64 };

/**
 * @param {string} name
 * @returns {Codec}
 */
export function getCodec(name) {
  const codec = codecs[name];
  if (!codec) throw new Error(`butter: unknown codec "${name}"`);
  return codec;
}
