-- Tests for butter.url, butter.ip, butter.cookiejar, butter.headers, butter.config.
local T = require "harness"
local url = require "butter.url"
local ip = require "butter.ip"
local jar = require "butter.cookiejar"
local headers = require "butter.headers"
local config = require "butter.config"

print("butter.url")

T.test("parses a typical URL", function()
  local u = assert(url.parse("https://Example.com/a/b?c=1#frag"))
  T.eq(u.scheme, "https")
  T.eq(u.host, "example.com")
  T.eq(u.port, 443)
  T.eq(u.path, "/a/b?c=1")
  T.eq(u.host_header, "example.com")
  T.eq(u.origin, "https://example.com")
  T.eq(u.secure, true)
end)

T.test("non-default ports, IPv6 and empty paths", function()
  local u = assert(url.parse("http://example.com:8080"))
  T.eq(u.port, 8080)
  T.eq(u.path, "/")
  T.eq(u.host_header, "example.com:8080")
  local v6 = assert(url.parse("http://[2001:db8::1]:81/x"))
  T.eq(v6.host, "2001:db8::1")
  T.eq(v6.ipv6, true)
  T.eq(v6.host_header, "[2001:db8::1]:81")
  T.eq(assert(url.parse("https://a.test?q")).path, "/?q")
end)

T.test("rejects dangerous or malformed URLs", function()
  for _, bad in ipairs({
    "", "example.com", "ftp://example.com/", "https://user:pw@example.com/",
    "https://example.com/a b", "https://example.com/\r\nHost: evil", "https://exa mple.com/",
    "https://example.com:0/", "https://example.com:99999/", "https://ex%61mple.com/",
  }) do
    T.no(url.parse(bad), "should reject " .. bad)
  end
end)

print("butter.ip")

T.test("parses IPv4 and IPv6", function()
  local b, v = ip.parse("192.168.1.10")
  T.eq(v, 4)
  T.eq(ip.to_string(b, v), "192.168.1.10")
  b, v = ip.parse("2001:db8::ff00:42:8329")
  T.eq(v, 6)
  T.eq(ip.to_string(b, v), "2001:db8:0:0:0:ff00:42:8329")
  b, v = ip.parse("::ffff:10.0.0.1")
  T.eq(ip.to_string(b, v), "0:0:0:0:0:ffff:a00:1")
  T.no(ip.parse("010.0.0.1"), "octal-looking IPv4")
  T.no(ip.parse("1.2.3.256"))
  T.no(ip.parse("1::2::3"))
  T.no(ip.parse("fe80::1%eth0"))
  T.no(ip.parse("example.com"))
end)

T.test("flags reserved ranges", function()
  local reserved = {
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fd00::1", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::",
  }
  for _, addr in ipairs(reserved) do
    local b, v = ip.parse(addr)
    T.ok(b, "parse " .. addr)
    T.ok(ip.is_reserved(b, v), addr .. " should be reserved")
  end
  for _, addr in ipairs({ "93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8" }) do
    local b, v = ip.parse(addr)
    T.no(ip.is_reserved(b, v), addr .. " should be public")
  end
end)

print("butter.cookiejar")

local NOW = 1700000000
local site = assert(url.parse("https://www.example.com/shop/cart?x=1"))

T.test("parses cookie dates", function()
  T.eq(jar.parse_date("Wed, 21 Oct 2015 07:28:00 GMT"), 1445412480)
  T.eq(jar.parse_date("Wednesday, 21-Oct-15 07:28:00 GMT"), 1445412480)
  T.eq(jar.parse_date("Wed Oct 21 07:28:00 2015"), 1445412480)
  T.no(jar.parse_date("not a date"))
end)

T.test("default path and matching rules", function()
  T.eq(jar.default_path("/shop/cart?x=1"), "/shop")
  T.eq(jar.default_path("/cart"), "/")
  T.ok(jar.path_match("/shop/cart", "/shop"))
  T.no(jar.path_match("/shopping", "/shop"))
  T.ok(jar.domain_match("www.example.com", "example.com"))
  T.no(jar.domain_match("badexample.com", "example.com"))
end)

T.test("parses Set-Cookie attributes", function()
  local c = assert(jar.parse_set_cookie("sid=abc; Path=/; Domain=.example.com; Secure; HttpOnly; Max-Age=60; SameSite=Lax", site, NOW))
  T.eq(c.name, "sid")
  T.eq(c.value, "abc")
  T.eq(c.domain, "example.com")
  T.eq(c.host_only, false)
  T.eq(c.path, "/")
  T.eq(c.secure, true)
  T.eq(c.http_only, true)
  T.eq(c.expires, NOW + 60)
  T.eq(c.same_site, "lax")
  local h = assert(jar.parse_set_cookie("theme=dark", site, NOW))
  T.eq(h.host_only, true)
  T.eq(h.domain, "www.example.com")
  T.eq(h.path, "/shop")
end)

T.test("rejects cookies the browser would reject", function()
  local insecure = assert(url.parse("http://www.example.com/"))
  T.no(jar.parse_set_cookie("a=1; Domain=other.com", site, NOW), "foreign domain")
  T.no(jar.parse_set_cookie("a=1; Domain=com", site, NOW), "public suffix")
  T.no(jar.parse_set_cookie("a=1; Secure", insecure, NOW), "Secure over http")
  T.no(jar.parse_set_cookie("__Host-a=1; Secure; Path=/; Domain=example.com", site, NOW), "__Host- with Domain")
  T.ok(jar.parse_set_cookie("__Host-a=1; Secure; Path=/", site, NOW), "valid __Host-")
end)

T.test("upsert, expiry and Cookie header", function()
  local list = {}
  list = jar.upsert(list, jar.parse_set_cookie("a=1; Path=/", site, NOW), NOW)
  list = jar.upsert(list, jar.parse_set_cookie("b=2; Path=/shop", site, NOW), NOW)
  list = jar.upsert(list, jar.parse_set_cookie("s=x; Secure; HttpOnly; Path=/", site, NOW + 1), NOW + 1)
  -- Replacing a cookie keeps its original creation time (RFC 6265 5.3 step 11.3).
  list = jar.upsert(list, jar.parse_set_cookie("a=3; Path=/", site, NOW + 2), NOW + 2)
  T.eq(#list, 3)
  T.eq(jar.header(list, site, NOW + 2), "b=2; a=3; s=x", "longest path first, then oldest")
  T.eq(jar.header(list, site, NOW + 2, { for_script = true }), "b=2; a=3", "no HttpOnly for scripts")
  T.eq(jar.header(list, assert(url.parse("http://www.example.com/")), NOW + 2), "a=3", "no Secure over http")
  T.eq(jar.header(list, assert(url.parse("https://example.com/")), NOW + 2), "", "host-only cookies")
  list = jar.upsert(list, jar.parse_set_cookie("a=; Max-Age=0; Path=/", site, NOW + 3), NOW + 3)
  T.eq(jar.header(list, site, NOW + 3), "b=2; s=x", "Max-Age=0 deletes")
end)

T.test("scripts cannot overwrite or create HttpOnly cookies", function()
  local list = jar.upsert({}, jar.parse_set_cookie("s=server; HttpOnly; Path=/", site, NOW), NOW)
  list = jar.upsert(list, jar.parse_set_cookie("s=script; Path=/", site, NOW), NOW, { from_script = true })
  T.eq(jar.header(list, site, NOW), "s=server")
  list = jar.upsert(list, jar.parse_set_cookie("t=1; HttpOnly", site, NOW), NOW, { from_script = true })
  T.eq(#list, 1)
end)

T.test("caps the number of cookies", function()
  local list = {}
  for i = 1, 10 do
    list = jar.upsert(list, jar.parse_set_cookie("c" .. i .. "=1", site, NOW + i), NOW + i, { max = 5 })
  end
  T.eq(#list, 5)
end)

print("butter.headers")

T.test("sanitizes request headers", function()
  local list = assert(headers.sanitize_request({
    Accept = "text/html", ["x-butter-url"] = "x", Host = "evil", Cookie = "a=b", ["Content-Type"] = "text/plain",
  }))
  T.eq(#list, 2)
  T.eq(list[1][1], "Accept")
  T.eq(list[2][1], "Content-Type")
  T.no(headers.sanitize_request({ ["bad name"] = "x" }), "invalid name")
  T.no(headers.sanitize_request({ ["X-A"] = "a\r\nInjected: 1" }), "CRLF in value")
  T.no(headers.sanitize_request("nope"), "not a table")
end)

print("butter.config")

T.test("defaults and merging", function()
  local cfg = config.load(nil)
  T.eq(cfg.prefix, "/butter/go/")
  T.eq(cfg.codec, "plain")
  local pub = config.public()
  T.eq(pub.transport.fetch, "/butter/fetch")
  T.eq(pub.client, "/butter/client.js")
  T.eq(#pub.transports, 1)
  T.eq(pub.transports[1].name, "butter")
  T.eq(pub.transports[1].url, "/butter/transports/butter.js", "url defaults under base")
  T.eq(pub.defaultTransport, "butter")
end)

T.test("transport list validation", function()
  local ok, err = pcall(config.load, CONFIG_FIXTURE_BAD_TRANSPORT)
  T.no(ok, "a default that is not offered must be rejected")
  T.ok(tostring(err):find("default_transport", 1, true), "error names the setting")
  config.load(nil)
end)

T.test("user config overrides nested values without losing defaults", function()
  -- CONFIG_FIXTURE is written by run.mjs:
  -- return { codec = "xor", guard = {}, dns = { nameservers = { "9.9.9.9" } } }
  local cfg = config.load(CONFIG_FIXTURE)
  T.eq(cfg.codec, "xor")
  T.eq(cfg.guard.allow_private, false, "empty table keeps defaults")
  T.eq(#cfg.dns.nameservers, 1, "lists replace wholesale")
  T.eq(cfg.dns.nameservers[1], "9.9.9.9")
  T.eq(cfg.dns.timeout, 2000)
  T.eq(config.load("/no/such/config.lua").codec, "plain", "missing file means defaults")
end)

return T
