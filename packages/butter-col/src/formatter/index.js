/**
 * butter-col formatter: everything that turns a target site's content into
 * content that keeps working when served from the proxy origin.
 *
 * It is shared by the service worker (src/sw) and the in-page runtime
 * (src/client) and has no dependencies on either environment beyond the
 * standard URL / TextEncoder APIs.
 */

import { createUrlRewriter, MODULE_WORKER_MARK } from "./url.js";
import { rewriteCss } from "./css.js";
import { rewriteJs, LOCATION, EVAL_WRAP, UNREWRITE } from "./js.js";
import { rewriteHtml, rewriteAttribute, rewriteRefresh, URL_ATTRS, decodeEntities, escapeAttribute } from "./html.js";
import { codecs, getCodec } from "./codecs.js";

/**
 * @typedef {object} FormatterConfig
 * @property {string} origin  Proxy origin
 * @property {string} prefix  Prefix for proxied URLs, e.g. "/butter/go/"
 * @property {string} codec   Codec name
 */

/**
 * @param {FormatterConfig} config
 */
export function createFormatter(config) {
  const url = createUrlRewriter(config);

  const formatter = {
    config,
    url,
    /** @param {string} raw @param {string | URL} base @param {{ moduleWorker?: boolean }} [opts] */
    rewriteUrl: (raw, base, opts) => url.rewrite(raw, base, opts),
    /** @param {string} proxied */
    unrewriteUrl: (proxied) => url.unrewrite(proxied),
    /** @param {string} src @param {string | URL} base */
    css: (src, base) => rewriteCss(src, base, url.rewrite),
    /** @param {string} src */
    js: (src) => rewriteJs(src),
    /** @param {string} src @param {{ base: string, inject?: string }} options */
    html: (src, options) => rewriteHtml(src, formatter, options),
    /** @param {string} tag @param {string} name @param {string} value @param {{ base: string, inject?: string }} ctx */
    attr: (tag, name, value, ctx) => rewriteAttribute(formatter, tag, name, value, ctx),
    /** @param {string} value @param {string} base */
    refresh: (value, base) => rewriteRefresh(formatter, value, base),
  };
  return formatter;
}

/** @typedef {ReturnType<typeof createFormatter>} Formatter */

export {
  codecs,
  getCodec,
  rewriteCss,
  rewriteJs,
  rewriteHtml,
  decodeEntities,
  escapeAttribute,
  URL_ATTRS,
  MODULE_WORKER_MARK,
  LOCATION,
  EVAL_WRAP,
  UNREWRITE,
};
