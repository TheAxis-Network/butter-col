/**
 * JavaScript rewriting.
 *
 * butter-col does not parse JavaScript into an AST. Instead a small,
 * error-tolerant tokenizer walks the source and applies a handful of targeted
 * edits. Everything else (fetches, imports, workers, ...) is handled at
 * runtime by the service worker and the client hooks, so the rewriter only
 * has to deal with what cannot be hooked:
 *
 *   location / x.location / x?.location / x["location"]
 *       -> __butter$location   (resolved by an accessor on Object.prototype)
 *   eval(code)
 *       -> eval(__butter$js(code))   (stays a *direct* eval)
 *   import.meta.url
 *       -> __butter$unrewrite(import.meta.url)
 *
 * The tokenizer never edits inside strings, template text, comments or regex
 * literals, and every edit is local, so a mis-scan can at worst miss an edit.
 */

export const LOCATION = "__butter$location";
export const EVAL_WRAP = "__butter$js";
export const UNREWRITE = "__butter$unrewrite";

const NEEDS_REWRITE = /location|eval|import\s*\.\s*meta/;

/** Identifiers after which a `/` starts a regular expression. */
const EXPR_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await", "extends",
]);

/** Punctuators after which `{` opens an object literal rather than a block. */
const OBJECT_AFTER_PUNC = new Set([
  "(", "[", ",", "=", ":", "?", "...", "!", "&", "|", "^", "~", "+", "-", "*", "/", "%",
  "<", ">", "${", "??", "?.",
]);
const OBJECT_AFTER_KEYWORD = new Set([
  "return", "yield", "await", "typeof", "void", "in", "of", "case", "throw", "delete",
]);

const IMPORT_META_URL = /import\s*\.\s*meta\s*\.\s*url(?![\w$])/y;

function isIdStart(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 36 || c === 95 || c >= 128;
}

function isIdPart(c) {
  return isIdStart(c) || (c >= 48 && c <= 57);
}

function isWhitespace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12 ||
    c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029 || c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) || c === 0x202f || c === 0x205f || c === 0x3000;
}

function isLineTerminator(c) {
  return c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
}

/**
 * @param {string} src
 * @returns {string}
 */
export function rewriteJs(src) {
  if (typeof src !== "string" || !NEEDS_REWRITE.test(src)) return src;

  const n = src.length;
  /** @type {Array<[number, number, string]>} start, end, replacement */
  const edits = [];

  let prevType = ""; // "id" | "num" | "str" | "tmpl" | "regex" | "punc"
  let prevVal = "";
  let prev2Type = "";
  let prev2Val = "";
  /** Open `{` kinds: "obj" | "block" | "ie-import" | "ie-export" | "tmpl" */
  const braces = [];
  /** Open `(`: null, or the index of the `(` of an eval call */
  const parens = [];
  /** Inside an import statement, before `from` */
  let inImport = false;

  const push = (type, val) => {
    prev2Type = prevType;
    prev2Val = prevVal;
    prevType = type;
    prevVal = val;
  };

  /** Index of the next character that is not whitespace or a comment. */
  const skipTrivia = (pos) => {
    while (pos < n) {
      const c = src.charCodeAt(pos);
      if (isWhitespace(c)) {
        pos++;
      } else if (c === 47 && src.charCodeAt(pos + 1) === 47) {
        while (pos < n && !isLineTerminator(src.charCodeAt(pos))) pos++;
      } else if (c === 47 && src.charCodeAt(pos + 1) === 42) {
        const end = src.indexOf("*/", pos + 2);
        pos = end === -1 ? n : end + 2;
      } else {
        break;
      }
    }
    return pos;
  };

  const peekWord = (pos) => {
    let j = skipTrivia(pos);
    const start = j;
    while (j < n && isIdPart(src.charCodeAt(j))) j++;
    return src.slice(start, j);
  };

  const regexAllowed = () => {
    if (!prevType) return true;
    if (prevType === "punc") return prevVal !== ")" && prevVal !== "]" && prevVal !== "++" && prevVal !== "--";
    if (prevType === "id") return EXPR_KEYWORDS.has(prevVal);
    return false;
  };

  const scanString = (i, quote) => {
    let j = i + 1;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) j += 2;
      else if (c === quote) return j + 1;
      else if (c === 10 || c === 13) return j; // unterminated, recover
      else j++;
    }
    return n;
  };

  /** Scan template text starting at j. Returns [end, opensSubstitution]. */
  const scanTemplate = (j) => {
    while (j < n) {
      const c = src.charCodeAt(j);
      if (c === 92) j += 2;
      else if (c === 96) return [j + 1, false];
      else if (c === 36 && src.charCodeAt(j + 1) === 123) return [j + 2, true];
      else j++;
    }
    return [n, false];
  };

  /** Returns the end of the regex literal starting at i, or -1. */
  const scanRegex = (i) => {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const c = src.charCodeAt(j);
      if (isLineTerminator(c)) return -1;
      if (c === 92) {
        if (j + 1 >= n || isLineTerminator(src.charCodeAt(j + 1))) return -1;
        j += 2;
        continue;
      }
      if (inClass) {
        if (c === 93) inClass = false;
      } else if (c === 91) {
        inClass = true;
      } else if (c === 47) {
        j++;
        while (j < n && isIdPart(src.charCodeAt(j))) j++;
        return j;
      }
      j++;
    }
    return -1;
  };

  const handleTemplate = (start) => {
    const [end, opens] = scanTemplate(start);
    if (opens) {
      braces.push("tmpl");
      push("punc", "${");
    } else {
      push("tmpl", "");
    }
    return end;
  };

  const handleLocation = (start, end) => {
    if (prevType === "punc" && (prevVal === "." || prevVal === "?.")) {
      edits.push([start, end, LOCATION]);
      return;
    }
    const top = braces[braces.length - 1];
    if (top === "ie-import" || top === "ie-export") {
      const importing = top === "ie-import";
      if (prevType === "id" && prevVal === "as") {
        if (importing) edits.push([start, end, LOCATION]); // local binding
      } else if (peekWord(end) === "as") {
        if (!importing) edits.push([start, end, LOCATION]); // local binding
      } else {
        edits.push([start, end, importing ? `location as ${LOCATION}` : `${LOCATION} as location`]);
      }
      return;
    }
    if (top === "obj" && prevType === "punc" && (prevVal === "{" || prevVal === ",")) {
      const next = src[skipTrivia(end)];
      if (next === ":") return; // property key
      if (next === "," || next === "}") {
        edits.push([start, end, `location: ${LOCATION}`]); // shorthand property
        return;
      }
    }
    edits.push([start, end, LOCATION]);
  };

  let i = 0;
  if (src.startsWith("#!")) {
    while (i < n && !isLineTerminator(src.charCodeAt(i))) i++;
  }

  while (i < n) {
    const c = src.charCodeAt(i);

    if (isWhitespace(c)) {
      i++;
      continue;
    }

    // Comments, regular expressions and division.
    if (c === 47) {
      const d = src.charCodeAt(i + 1);
      if (d === 47 || d === 42) {
        i = skipTrivia(i);
        continue;
      }
      if (regexAllowed()) {
        const end = scanRegex(i);
        if (end !== -1) {
          i = end;
          push("regex", "");
          continue;
        }
      }
      i++;
      push("punc", "/");
      continue;
    }

    // Strings.
    if (c === 34 || c === 39) {
      const end = scanString(i, c);
      const value = src.slice(i + 1, end - 1);
      if (
        value === "location" &&
        prevType === "punc" && prevVal === "[" &&
        ((prev2Type === "id" && !EXPR_KEYWORDS.has(prev2Val)) || prev2Val === ")" || prev2Val === "]") &&
        src[skipTrivia(end)] === "]"
      ) {
        const quote = src[i];
        edits.push([i, end, quote + LOCATION + quote]);
      }
      i = end;
      push("str", value);
      continue;
    }

    // Template literals.
    if (c === 96) {
      i = handleTemplate(i + 1);
      continue;
    }

    // Identifiers and keywords.
    if (isIdStart(c) || c === 92) {
      let j = i;
      let escaped = false;
      while (j < n) {
        const cc = src.charCodeAt(j);
        if (cc === 92) {
          // \uXXXX or \u{X...} escape inside an identifier
          escaped = true;
          if (src.charCodeAt(j + 2) === 123) {
            const close = src.indexOf("}", j);
            j = close === -1 ? n : close + 1;
          } else {
            j += 6;
          }
        } else if (isIdPart(cc) && !isWhitespace(cc)) {
          j++;
        } else {
          break;
        }
      }
      const value = src.slice(i, j);
      const afterDot = prevType === "punc" && (prevVal === "." || prevVal === "?.");

      if (!escaped) {
        if (value === "location") {
          handleLocation(i, j);
        } else if (value === "import" && !afterDot) {
          IMPORT_META_URL.lastIndex = i;
          if (IMPORT_META_URL.test(src)) {
            const end = IMPORT_META_URL.lastIndex;
            edits.push([i, end, `${UNREWRITE}(import.meta.url)`]);
            i = end;
            push("punc", ")");
            continue;
          }
          const next = src[skipTrivia(j)];
          if (next !== "(" && next !== ".") inImport = true;
        } else if (value === "from" && inImport) {
          inImport = false;
        }
      }

      i = j;
      push("id", value);
      continue;
    }

    // Private names and numbers.
    if (c === 35) {
      let j = i + 1;
      while (j < n && isIdPart(src.charCodeAt(j))) j++;
      push("id", src.slice(i, j));
      i = j;
      continue;
    }
    if ((c >= 48 && c <= 57) || (c === 46 && src.charCodeAt(i + 1) >= 48 && src.charCodeAt(i + 1) <= 57)) {
      let j = i + 1;
      while (j < n) {
        const cc = src.charCodeAt(j);
        if (isIdPart(cc) || cc === 46) j++;
        else break;
      }
      i = j;
      push("num", "");
      continue;
    }

    // Punctuators.
    switch (c) {
      case 123: { // {
        let kind = "block";
        if (prevType === "id" && (prevVal === "import" || prevVal === "export") && prev2Val !== "." && prev2Val !== "?.") {
          kind = "ie-" + prevVal;
        } else if (inImport && prevType === "punc" && prevVal === ",") {
          kind = "ie-import";
        } else if ((prevType === "punc" && OBJECT_AFTER_PUNC.has(prevVal)) || (prevType === "id" && OBJECT_AFTER_KEYWORD.has(prevVal))) {
          kind = "obj";
        }
        braces.push(kind);
        i++;
        push("punc", "{");
        continue;
      }
      case 125: { // }
        const kind = braces.pop();
        if (kind === "tmpl") {
          i = handleTemplate(i + 1);
          continue;
        }
        i++;
        push("punc", "}");
        continue;
      }
      case 40: { // (
        const isEvalCall = prevType === "id" && prevVal === "eval" &&
          prev2Val !== "." && prev2Val !== "?." && prev2Val !== "function";
        parens.push(isEvalCall ? i : null);
        i++;
        push("punc", "(");
        continue;
      }
      case 41: { // )
        const open = parens.pop();
        // `eval(x) {` is a method definition, not a call.
        if (open != null && src[skipTrivia(i + 1)] !== "{") {
          edits.push([open + 1, open + 1, EVAL_WRAP + "("]);
          edits.push([i, i, ")"]);
        }
        i++;
        push("punc", ")");
        continue;
      }
      case 46: // .
        if (src.charCodeAt(i + 1) === 46 && src.charCodeAt(i + 2) === 46) {
          i += 3;
          push("punc", "...");
        } else {
          i++;
          push("punc", ".");
        }
        continue;
      case 63: { // ?
        const d = src.charCodeAt(i + 1);
        const e = src.charCodeAt(i + 2);
        if (d === 46 && !(e >= 48 && e <= 57)) {
          i += 2;
          push("punc", "?.");
        } else if (d === 63) {
          i += 2;
          push("punc", "??");
        } else {
          i++;
          push("punc", "?");
        }
        continue;
      }
      case 43: // +
      case 45: // -
        if (src.charCodeAt(i + 1) === c) {
          i += 2;
          push("punc", c === 43 ? "++" : "--");
        } else {
          i++;
          push("punc", src[i - 1]);
        }
        continue;
      case 61: // =
        if (src.charCodeAt(i + 1) === 62) {
          i += 2;
          push("punc", "=>");
        } else {
          i++;
          push("punc", "=");
        }
        continue;
      case 59: // ;
        inImport = false;
        i++;
        push("punc", ";");
        continue;
      default:
        i++;
        push("punc", src[i - 1]);
    }
  }

  if (edits.length === 0) return src;

  edits.sort((a, b) => a[0] - b[0] || (a[1] - a[0]) - (b[1] - b[0]));
  let out = "";
  let last = 0;
  for (const [start, end, text] of edits) {
    if (start < last) continue; // overlapping edit; keep the first
    out += src.slice(last, start) + text;
    last = end;
  }
  return out + src.slice(last);
}
