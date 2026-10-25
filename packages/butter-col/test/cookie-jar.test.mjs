// Tests for the service worker's client-side cookie jar (used by transports
// with meta.cookies === "client"). Mirrors test/lua/test_modules.lua so the
// two jars stay in agreement. Node 22.18+/24 load the .ts file directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cookieHeader, defaultPath, parseCookieDate, parseSetCookie, upsert } from "../src/sw/cookie-jar.ts";

const NOW = 1_700_000_000_000;
const site = new URL("https://www.example.com/shop/cart?x=1");

test("dates", () => {
  assert.equal(parseCookieDate("Wed, 21 Oct 2015 07:28:00 GMT"), 1445412480000);
  assert.equal(parseCookieDate("Wednesday, 21-Oct-15 07:28:00 GMT"), 1445412480000);
  assert.equal(parseCookieDate("Wed Oct 21 07:28:00 2015"), 1445412480000);
  assert.equal(parseCookieDate("not a date"), null);
});

test("default path", () => {
  assert.equal(defaultPath("/shop/cart"), "/shop");
  assert.equal(defaultPath("/cart"), "/");
});

test("attributes", () => {
  const c = parseSetCookie("sid=abc; Path=/; Domain=.example.com; Secure; HttpOnly; Max-Age=60; SameSite=Lax", site, NOW);
  assert.equal(c.domain, "example.com");
  assert.equal(c.hostOnly, false);
  assert.equal(c.secure, true);
  assert.equal(c.httpOnly, true);
  assert.equal(c.expires, NOW + 60_000);
  const h = parseSetCookie("theme=dark", site, NOW);
  assert.equal(h.hostOnly, true);
  assert.equal(h.path, "/shop");
});

test("rejections", () => {
  assert.equal(parseSetCookie("a=1; Domain=other.com", site, NOW), null);
  assert.equal(parseSetCookie("a=1; Domain=com", site, NOW), null);
  assert.equal(parseSetCookie("a=1; Secure", new URL("http://www.example.com/"), NOW), null);
  assert.equal(parseSetCookie("__Host-a=1; Secure; Path=/; Domain=example.com", site, NOW), null);
  assert.ok(parseSetCookie("__Host-a=1; Secure; Path=/", site, NOW));
});

test("upsert, ordering, expiry and visibility", () => {
  let list = [];
  list = upsert(list, parseSetCookie("a=1; Path=/", site, NOW), NOW);
  list = upsert(list, parseSetCookie("b=2; Path=/shop", site, NOW), NOW);
  list = upsert(list, parseSetCookie("s=x; Secure; HttpOnly; Path=/", site, NOW + 1000), NOW + 1000);
  list = upsert(list, parseSetCookie("a=3; Path=/", site, NOW + 2000), NOW + 2000);
  assert.equal(list.length, 3);
  assert.equal(cookieHeader(list, site, NOW + 2000), "b=2; a=3; s=x");
  assert.equal(cookieHeader(list, site, NOW + 2000, { forScript: true }), "b=2; a=3");
  assert.equal(cookieHeader(list, new URL("http://www.example.com/"), NOW + 2000), "a=3");
  assert.equal(cookieHeader(list, new URL("wss://www.example.com/shop/ws"), NOW + 2000), "b=2; a=3; s=x", "wss counts as secure");
  list = upsert(list, parseSetCookie("a=; Max-Age=0; Path=/", site, NOW + 3000), NOW + 3000);
  assert.equal(cookieHeader(list, site, NOW + 3000), "b=2; s=x");
});

test("scripts cannot touch HttpOnly cookies", () => {
  let list = upsert([], parseSetCookie("s=server; HttpOnly; Path=/", site, NOW), NOW);
  list = upsert(list, parseSetCookie("s=script; Path=/", site, NOW), NOW, { fromScript: true });
  assert.equal(cookieHeader(list, site, NOW), "s=server");
});
