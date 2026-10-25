import { test } from "node:test";
import assert from "node:assert/strict";
import { createFormatter, codecs, rewriteJs } from "../src/formatter/index.js";

const ORIGIN = "https://proxy.test";
const PREFIX = "/butter/go/";
const f = createFormatter({ origin: ORIGIN, prefix: PREFIX, codec: "plain" });
const BASE = "https://example.com/dir/page.html";
const enc = (u) => ORIGIN + PREFIX + encodeURIComponent(u);

test("codecs round-trip", () => {
  const urls = ["https://example.com/", "https://ex.com/a b/ü?q=1&x=%20", "http://[::1]:8080/p?x#ignored"];
  for (const [name, codec] of Object.entries(codecs)) {
    for (const url of urls) assert.equal(codec.decode(codec.encode(url)), url, `${name}: ${url}`);
  }
});

test("url rewrite / unrewrite", () => {
  assert.equal(f.rewriteUrl("/a.png", BASE), enc("https://example.com/a.png"));
  assert.equal(f.rewriteUrl("b.png", BASE), enc("https://example.com/dir/b.png"));
  assert.equal(f.rewriteUrl("//cdn.test/x.js", BASE), enc("https://cdn.test/x.js"));
  assert.equal(f.rewriteUrl("https://a.test/p#frag", BASE), enc("https://a.test/p") + "#frag");
  for (const keep of ["#top", "data:text/plain,hi", "mailto:a@b.c", "javascript:void 0", "blob:x", ""]) {
    assert.equal(f.rewriteUrl(keep, BASE), keep);
  }
  const proxied = f.rewriteUrl("/x?y=1", BASE);
  assert.equal(f.rewriteUrl(proxied, BASE), proxied, "idempotent");
  assert.equal(f.unrewriteUrl(proxied), "https://example.com/x?y=1");
  assert.equal(f.unrewriteUrl(proxied + "#h"), "https://example.com/x?y=1#h");
  assert.equal(f.unrewriteUrl(proxied + "?page=2"), "https://example.com/x?page=2", "raw search replaces target search");
  assert.equal(f.unrewriteUrl("https://other.test/"), "https://other.test/");
  assert.equal(f.unrewriteUrl(ORIGIN + PREFIX + "junk.png"), ORIGIN + PREFIX + "junk.png");
});

test("module worker marker", () => {
  const url = f.rewriteUrl("/w.js", BASE, { moduleWorker: true });
  assert.ok(url.startsWith(ORIGIN + PREFIX + "~m/"));
  assert.equal(f.unrewriteUrl(url), "https://example.com/w.js");
});

test("srcset", () => {
  const out = f.url.rewriteSrcset("a.png 1x, /b.png 2x,data:image/png;base64,AA== 3x", BASE);
  assert.equal(out, `${enc("https://example.com/dir/a.png")} 1x, ${enc("https://example.com/b.png")} 2x,data:image/png;base64,AA== 3x`);
  assert.equal(f.url.unrewriteSrcset(out), "https://example.com/dir/a.png 1x, https://example.com/b.png 2x,data:image/png;base64,AA== 3x");
});

test("css", () => {
  const css = `a{background:url(/bg.png)} b{background:url( "x.png" )} c{mask:url(#m)} @import 'theme.css'; d{x:url(data:a,b)}`;
  const out = f.css(css, BASE);
  assert.match(out, new RegExp(`url\\("${escape(enc("https://example.com/bg.png"))}"\\)`));
  assert.ok(out.includes(`url("${enc("https://example.com/dir/x.png")}")`));
  assert.ok(out.includes("url(#m)"));
  assert.ok(out.includes(`@import "${enc("https://example.com/dir/theme.css")}"`));
  assert.ok(out.includes("url(data:a,b)"));
});

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("js: location rewriting", () => {
  const cases = [
    ["location.href", "__butter$location.href"],
    ["window.location.href = x", "window.__butter$location.href = x"],
    ["a?.location", "a?.__butter$location"],
    ["document['location']", "document['__butter$location']"],
    ["['location']", "['location']"],
    ["return ['location']", "return ['location']"],
    ["var o = { location: 1 }", "var o = { location: 1 }"],
    ["var o = { location }", "var o = { location: __butter$location }"],
    ["const { location } = window", "const { __butter$location } = window"],
    ["var a, location, b", "var a, __butter$location, b"],
    ["'location' + \"location\" + `location ${location}`", "'location' + \"location\" + `location ${__butter$location}`"],
    ["// location\n/* location */ x", "// location\n/* location */ x"],
    ["x = /location/.test(y)", "x = /location/.test(y)"],
    ["a = b / location / c", "a = b / __butter$location / c"],
    ["obj.locations + mylocation", "obj.locations + mylocation"],
    ["import { location } from './a.js'", "import { location as __butter$location } from './a.js'"],
    ["import { location as loc } from './a.js'", "import { location as loc } from './a.js'"],
    ["import def, { location } from './a.js'", "import def, { location as __butter$location } from './a.js'"],
    ["export { location }", "export { __butter$location as location }"],
    ["x ? location : y", "x ? __butter$location : y"],
    ["`${ {a: location}.a }`", "`${ {a: __butter$location}.a }`"],
  ];
  for (const [input, expected] of cases) assert.equal(rewriteJs(input), expected, input);
});

test("js: eval and import.meta", () => {
  assert.equal(rewriteJs("eval(code)"), "eval(__butter$js(code))");
  assert.equal(rewriteJs("eval(f(a), b)"), "eval(__butter$js(f(a), b))");
  assert.equal(rewriteJs("x.eval(code)"), "x.eval(code)");
  assert.equal(rewriteJs("({ eval(a) { return a } })"), "({ eval(a) { return a } })");
  assert.equal(rewriteJs("new URL('w.js', import.meta.url)"), "new URL('w.js', __butter$unrewrite(import.meta.url))");
  const unchanged = "function add(a, b) { return a + b }";
  assert.equal(rewriteJs(unchanged), unchanged);
});

test("html: attributes, raw text and injection", () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><base href="/sub/"><link rel=stylesheet href="s.css" integrity="sha384-x"></head>` +
    `<body><a href="/p?a=1&amp;b=2" onclick="location.reload()">x</a><img srcset="i.png 2x" style="background:url(bg.png)">` +
    `<script>if (location.hash) eval(s)</script><script type="application/json">{"location":1}</script>` +
    `<textarea><a href="/no"></textarea><iframe sandbox="allow-scripts" srcdoc="<img src='x.png'>"></iframe>` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta http-equiv="refresh" content="0; url=/next"></body></html>`;
  const out = f.html(html, { base: BASE, inject: "<!--INJECT-->" });

  assert.ok(out.startsWith(`<!doctype html><html><head><!--INJECT--><meta charset="utf-8">`), "injected after <head>");
  assert.ok(out.includes(`href="${enc("https://example.com/sub/s.css")}"`), "relative to <base>");
  assert.ok(out.includes(`data-butter-integrity="sha384-x"`));
  assert.ok(out.includes(`href="${enc("https://example.com/p?a=1&b=2")}"`), "entities decoded before rewriting");
  assert.ok(out.includes(`onclick="__butter$location.reload()"`));
  assert.ok(out.includes(`srcset="${enc("https://example.com/sub/i.png")} 2x"`));
  assert.ok(out.includes(`<script>if (__butter$location.hash) eval(__butter$js(s))</script>`));
  assert.ok(out.includes(`<script type="application/json">{"location":1}</script>`));
  assert.ok(out.includes(`<textarea><a href="/no"></textarea>`), "raw text untouched");
  assert.ok(out.includes(`data-butter-sandbox="allow-scripts"`));
  assert.ok(out.includes(`srcdoc="<!--INJECT--><img src=&quot;${enc("https://example.com/sub/x.png")}&quot;>"`));
  assert.ok(out.includes(`data-butter-http-equiv="Content-Security-Policy"`));
  assert.ok(out.includes(`content="0; url=${enc("https://example.com/next")}"`));
});

test("html: injection without head, unchanged tags keep their source", () => {
  assert.equal(f.html("<!DOCTYPE html><title>t</title>", { base: BASE, inject: "[I]" }), "<!DOCTYPE html>[I]<title>t</title>");
  assert.equal(f.html("<!DOCTYPE html>text only", { base: BASE, inject: "[I]" }), "<!DOCTYPE html>[I]text only");
  const src = `<div   class='a'  id=b data-x="y">hi</div>`;
  assert.equal(f.html(src, { base: BASE }), src);
  assert.equal(f.html(`<svg><script/><a href="/s"/></svg><p>`, { base: BASE }), `<svg><script/><a href="${enc("https://example.com/s")}"/></svg><p>`);
});
