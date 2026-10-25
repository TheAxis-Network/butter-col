/**
 * CSS rewriting: url(...) references and @import strings.
 */

const URL_FUNCTION = /url\(\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|((?:[^)\s"'\\]|\\.)*))\s*\)/gi;
const IMPORT_STRING = /@import\s+(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/gi;

/**
 * @param {string} css
 * @param {string | URL} base
 * @param {(url: string, base: string | URL) => string} rewriteUrl
 * @returns {string}
 */
export function rewriteCss(css, base, rewriteUrl) {
  if (!css || (css.indexOf("url(") === -1 && css.indexOf("URL(") === -1 && css.indexOf("@import") === -1)) {
    return css;
  }
  const map = (raw) => {
    // CSS escapes inside URLs are rare; only unescape the trivial cases.
    const url = raw.replace(/\\([^0-9a-fA-F\n])/g, "$1");
    if (!url || url.startsWith("#") || /^data:/i.test(url)) return null;
    const rewritten = rewriteUrl(url, base);
    return rewritten === url ? null : rewritten;
  };
  return css
    .replace(URL_FUNCTION, (match, dq, sq, bare) => {
      const raw = dq ?? sq ?? bare ?? "";
      const rewritten = map(raw);
      return rewritten === null ? match : `url("${rewritten.replace(/["\\\n]/g, "\\$&")}")`;
    })
    .replace(IMPORT_STRING, (match, dq, sq) => {
      const rewritten = map(dq ?? sq ?? "");
      return rewritten === null ? match : `@import "${rewritten.replace(/["\\\n]/g, "\\$&")}"`;
    });
}
