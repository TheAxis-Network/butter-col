/**
 * document.cookie mirror.
 *
 * The real cookie jar lives on the server (so HttpOnly cookies never reach
 * the page). Each document is served with the non-HttpOnly cookies visible
 * to it; writes update this local copy immediately and are sent back to the
 * server so the next request carries them.
 */

function parsePairs(str) {
  const jar = new Map();
  for (const part of str.split(";")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq === -1) jar.set("", part.trim());
    else jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return jar;
}

function isExpired(attributes) {
  for (const attr of attributes) {
    const eq = attr.indexOf("=");
    const key = (eq === -1 ? attr : attr.slice(0, eq)).trim().toLowerCase();
    const value = eq === -1 ? "" : attr.slice(eq + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(value)) return Number(value) <= 0;
    if (key === "expires") {
      const time = Date.parse(value);
      if (!Number.isNaN(time) && time <= Date.now()) return true;
    }
  }
  return false;
}

/**
 * @param {string} initial      document.cookie string provided by the server
 * @param {string} endpoint     write-back endpoint (POST)
 * @param {typeof fetch} fetchImpl  an unhooked fetch
 */
export function createCookieMirror(initial, endpoint, fetchImpl) {
  const jar = parsePairs(initial || "");

  return {
    get() {
      const parts = [];
      for (const [name, value] of jar) parts.push(name ? `${name}=${value}` : value);
      return parts.join("; ");
    },
    /**
     * @param {string} cookie  e.g. "theme=dark; Max-Age=3600; Path=/"
     * @param {string} url     target URL of the document setting it
     */
    set(cookie, url) {
      const [pair, ...attributes] = String(cookie).split(";");
      if (/httponly/i.test(attributes.join(";"))) return; // scripts cannot create HttpOnly cookies
      const eq = pair.indexOf("=");
      const name = eq === -1 ? "" : pair.slice(0, eq).trim();
      const value = eq === -1 ? pair.trim() : pair.slice(eq + 1).trim();
      if (isExpired(attributes)) jar.delete(name);
      else jar.set(name, value);

      fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, cookie: String(cookie) }),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => {});
    },
  };
}
