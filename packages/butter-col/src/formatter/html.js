/**
 * HTML rewriting with a small, forgiving tokenizer (service workers have no
 * DOMParser). Only start tags are modified; text, comments and end tags are
 * copied through byte for byte, and unchanged tags keep their exact source.
 */

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"]);

const JS_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript)|text\/jscript|text\/livescript|text\/javascript1\.[0-5])$/i;

/** Attributes holding a single URL, on any element. */
export const URL_ATTRS = new Set([
  "href", "src", "action", "formaction", "poster", "background", "cite", "longdesc",
  "manifest", "codebase", "icon", "lowsrc", "dynsrc", "xlink:href",
]);

/** Attributes whose name is changed so the browser ignores them. */
const NEUTRALIZE = {
  integrity: "data-butter-integrity",
  sandbox: "data-butter-sandbox", // sandboxed frames cannot be controlled by the service worker
};

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };
const ENTITY = /&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|(amp|lt|gt|quot|apos|nbsp)(?:;|(?![=\w])))/g;

/** @param {string} value */
export function decodeEntities(value) {
  if (value.indexOf("&") === -1) return value;
  return value.replace(ENTITY, (match, dec, hex, named) => {
    if (named) return NAMED_ENTITIES[named];
    const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : String.fromCharCode(0xfffd);
  });
}

/** @param {string} value */
export function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isWs(c) {
  return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}

function isLetter(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
}

/**
 * @typedef {object} RewriteContext
 * @property {string} base     Target base URL used to resolve relative URLs
 * @property {string} [inject] Markup inserted at the start of the document
 */

/**
 * Rewrite one attribute value. Returns the new value (possibly identical).
 * Shared by the HTML rewriter and the client runtime's setAttribute hook.
 *
 * @param {import("./index.js").Formatter} f
 * @param {string} tag   Lower-case tag name
 * @param {string} name  Attribute name
 * @param {string} value Decoded attribute value
 * @param {RewriteContext} ctx
 * @returns {string}
 */
export function rewriteAttribute(f, tag, name, value, ctx) {
  const attr = name.toLowerCase();
  if (attr.length > 2 && attr.startsWith("on")) return f.js(value);
  switch (attr) {
    case "style":
      return f.css(value, ctx.base);
    case "srcset":
    case "imagesrcset":
      return f.url.rewriteSrcset(value, ctx.base);
    case "ping":
      return value.split(/(\s+)/).map((part) => (part.trim() ? f.rewriteUrl(part, ctx.base) : part)).join("");
    case "srcdoc":
      return tag === "iframe" ? f.html(value, { base: ctx.base, inject: ctx.inject }) : value;
    case "data":
      return tag === "object" ? f.rewriteUrl(value, ctx.base) : value;
  }
  if (URL_ATTRS.has(attr)) {
    const trimmed = value.trim();
    if (/^javascript:/i.test(trimmed)) {
      const code = trimmed.slice(11);
      return code.indexOf("%") === -1 ? "javascript:" + f.js(code) : value;
    }
    return f.rewriteUrl(value, ctx.base);
  }
  return value;
}

/**
 * @typedef {object} Attr
 * @property {string} name
 * @property {string | null} value  Decoded value, null for boolean attributes
 * @property {number} start
 * @property {number} end
 * @property {string} [newName]
 * @property {string | null} [newValue]
 */

/**
 * Parse a start tag beginning at `i` (src[i] === "<", src[i + 1] is a letter).
 * @param {string} src
 * @param {number} i
 */
function parseStartTag(src, i) {
  const n = src.length;
  let j = i + 1;
  while (j < n) {
    const c = src.charCodeAt(j);
    if (isWs(c) || c === 47 || c === 62) break;
    j++;
  }
  const name = src.slice(i + 1, j).toLowerCase();
  /** @type {Attr[]} */
  const attrs = [];
  let selfClosing = false;

  while (j < n) {
    let c = src.charCodeAt(j);
    if (isWs(c)) {
      j++;
      continue;
    }
    if (c === 47) {
      if (src.charCodeAt(j + 1) === 62) {
        selfClosing = true;
        return { name, attrs, selfClosing, end: j + 2 };
      }
      j++;
      continue;
    }
    if (c === 62) return { name, attrs, selfClosing, end: j + 1 };

    const start = j++;
    while (j < n) {
      c = src.charCodeAt(j);
      if (isWs(c) || c === 47 || c === 62 || c === 61) break;
      j++;
    }
    const attrName = src.slice(start, j);
    let k = j;
    while (k < n && isWs(src.charCodeAt(k))) k++;
    if (src.charCodeAt(k) !== 61) {
      attrs.push({ name: attrName, value: null, start, end: j });
      continue;
    }
    k++;
    while (k < n && isWs(src.charCodeAt(k))) k++;
    const q = src.charCodeAt(k);
    let raw;
    if (q === 34 || q === 39) {
      const close = src.indexOf(q === 34 ? '"' : "'", k + 1);
      if (close === -1) return null;
      raw = src.slice(k + 1, close);
      j = close + 1;
    } else {
      const vs = k;
      while (k < n && !isWs(src.charCodeAt(k)) && src.charCodeAt(k) !== 62) k++;
      raw = src.slice(vs, k);
      j = k;
    }
    attrs.push({ name: attrName, value: decodeEntities(raw), start, end: j });
  }
  return null; // unterminated tag at end of input
}

/** @param {Attr[]} attrs @param {string} name */
function findAttr(attrs, name) {
  for (const attr of attrs) if (attr.name.toLowerCase() === name) return attr;
  return undefined;
}

/**
 * Work out the changes for one start tag, recording them on the attrs.
 * @returns {boolean} whether anything changed
 */
function transformTag(f, tag, ctx, state) {
  let changed = false;
  const { name, attrs } = tag;

  if (name === "meta") {
    const equiv = findAttr(attrs, "http-equiv");
    const kind = equiv && equiv.value ? equiv.value.trim().toLowerCase() : "";
    if (kind.startsWith("content-security-policy")) {
      equiv.newName = "data-butter-http-equiv";
      return true;
    }
    if (kind === "refresh") {
      const content = findAttr(attrs, "content");
      if (content && content.value) {
        const value = rewriteRefresh(f, content.value, ctx.base);
        if (value !== content.value) {
          content.newValue = value;
          changed = true;
        }
      }
    }
    return changed;
  }

  if (name === "base" && !state.baseSeen) {
    const href = findAttr(attrs, "href");
    if (href && href.value !== null) {
      state.baseSeen = true;
      try {
        ctx.base = new URL(href.value.trim(), ctx.base).href;
      } catch {
        // keep the previous base
      }
    }
  }

  for (const attr of attrs) {
    if (attr.value === null) continue;
    const lower = attr.name.toLowerCase();
    if (lower === "data-butter") return false; // our own markup
    const rename = NEUTRALIZE[lower];
    if (rename && (lower !== "sandbox" || name === "iframe")) {
      attr.newName = rename;
      changed = true;
      continue;
    }
    const value = rewriteAttribute(f, name, attr.name, attr.value, ctx);
    if (value !== attr.value) {
      attr.newValue = value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Rewrite the URL in a refresh value such as "5; url=/next".
 * @returns {string}
 */
export function rewriteRefresh(f, value, base) {
  const match = value.match(/^(\s*[\d.]*\s*[;,]?\s*(?:url\s*=\s*)?)(['"]?)(.*?)\2(\s*)$/i);
  if (!match || !match[3]) return value;
  return match[1] + match[2] + f.rewriteUrl(match[3], base) + match[2] + match[4];
}

function serializeTag(src, tag, i) {
  let out = "";
  let last = i;
  for (const attr of tag.attrs) {
    if (attr.newName === undefined && attr.newValue === undefined) continue;
    const name = attr.newName ?? attr.name;
    const value = attr.newValue !== undefined ? attr.newValue : attr.value;
    out += src.slice(last, attr.start) + name + (value === null ? "" : `="${escapeAttribute(value)}"`);
    last = attr.end;
  }
  return out + src.slice(last, tag.end);
}

const closeTagCache = new Map();
function findRawTextEnd(src, name, from) {
  let re = closeTagCache.get(name);
  if (!re) {
    re = new RegExp(`</${name}(?=[\\s/>])`, "ig");
    closeTagCache.set(name, re);
  }
  re.lastIndex = from;
  const match = re.exec(src);
  return match ? match.index : src.length;
}

/**
 * @param {string} html
 * @param {import("./index.js").Formatter} f
 * @param {RewriteContext} options
 * @returns {string}
 */
export function rewriteHtml(html, f, options) {
  const ctx = { base: options.base, inject: options.inject };
  const state = { injected: !options.inject, baseSeen: false, foreign: 0, doctypeEnd: -1 };
  const n = html.length;
  let out = "";
  let i = 0;

  const inject = () => {
    state.injected = true;
    return ctx.inject || "";
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);
    i = lt;
    const next = html.charCodeAt(i + 1);

    // Comments, doctype, CDATA and other markup declarations.
    if (next === 33 || next === 63) {
      let end;
      if (html.startsWith("<!--", i)) {
        if (html.startsWith("<!-->", i)) end = i + 5;
        else if (html.startsWith("<!--->", i)) end = i + 6;
        else {
          const close = html.indexOf("-->", i + 4);
          end = close === -1 ? n : close + 3;
        }
      } else if (state.foreign && html.startsWith("<![CDATA[", i)) {
        const close = html.indexOf("]]>", i + 9);
        end = close === -1 ? n : close + 3;
      } else {
        const close = html.indexOf(">", i + 2);
        end = close === -1 ? n : close + 1;
        if (/^<!doctype/i.test(html.slice(i, i + 9))) state.doctypeEnd = out.length + (end - i);
      }
      out += html.slice(i, end);
      i = end;
      continue;
    }

    // End tags.
    if (next === 47) {
      const close = html.indexOf(">", i + 2);
      const end = close === -1 ? n : close + 1;
      if (isLetter(html.charCodeAt(i + 2))) {
        const name = html.slice(i + 2, end).match(/^[^\s/>]*/)[0].toLowerCase();
        if ((name === "svg" || name === "math") && state.foreign > 0) state.foreign--;
      }
      out += html.slice(i, end);
      i = end;
      continue;
    }

    if (!isLetter(next)) {
      out += "<";
      i++;
      continue;
    }

    // Start tags.
    const tag = parseStartTag(html, i);
    if (!tag) {
      out += html.slice(i);
      break;
    }

    if (!state.injected && tag.name !== "html") {
      if (tag.name !== "head") out += inject();
    }

    out += transformTag(f, tag, ctx, state) ? serializeTag(html, tag, i) : html.slice(i, tag.end);
    i = tag.end;

    if (!state.injected && tag.name === "head") out += inject();
    if ((tag.name === "svg" || tag.name === "math") && !tag.selfClosing) state.foreign++;

    const raw = state.foreign
      ? (tag.name === "script" || tag.name === "style") && !tag.selfClosing
      : RAW_TEXT.has(tag.name);
    if (!raw) continue;

    if (tag.name === "plaintext") {
      out += html.slice(i);
      break;
    }
    const end = findRawTextEnd(html, tag.name, i);
    let content = html.slice(i, end);
    if (tag.name === "script" && !findAttr(tag.attrs, "data-butter")) {
      const type = findAttr(tag.attrs, "type");
      if (JS_TYPE.test(type && type.value ? type.value.trim() : "")) content = f.js(content);
    } else if (tag.name === "style") {
      content = f.css(content, ctx.base);
    }
    out += content;
    i = end;
  }

  if (!state.injected) {
    const markup = inject();
    if (state.doctypeEnd !== -1) out = out.slice(0, state.doctypeEnd) + markup + out.slice(state.doctypeEnd);
    else out = markup + out;
  }
  return out;
}
