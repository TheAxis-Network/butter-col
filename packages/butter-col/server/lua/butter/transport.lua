-- nginx phase handlers for butter-col's endpoints.
--
--   /butter/fetch   HTTP transport (access + header_filter around proxy_pass)
--   /butter/ws      WebSocket transport (access + header_filter around proxy_pass)
--   /butter/cookie  document.cookie write-back
--   /butter/config.js, /butter/health
--
-- The Lua code validates and prepares each request; nginx's proxy module
-- does the actual streaming, keep-alive and TLS work.

local cjson = require "cjson.safe"
local config = require "butter.config"
local url = require "butter.url"
local guard = require "butter.guard"
local headers = require "butter.headers"
local session = require "butter.session"
local store = require "butter.store"
local limit = require "butter.limit"

local M = {}

local function error_json(code, message)
  return cjson.encode({ code = code, message = message })
end

--- Send a JSON error and finish the request.
local function fail(status, code, message)
  ngx.status = status
  ngx.header["Content-Type"] = "application/json"
  ngx.header["Cache-Control"] = "no-store"
  ngx.header["X-Butter-Error"] = error_json(code, message)
  ngx.say(cjson.encode({ error = { code = code, message = message } }))
  return ngx.exit(ngx.HTTP_OK)
end

--- "https://host:port" -> does it name this server?
local function origin_is_self(origin)
  local host = origin:match("^%a[%w+.-]*://([^/]+)$")
  return host ~= nil and host:lower() == (ngx.var.http_host or ""):lower()
end

--- Was this request made by our own pages (and not by another website)?
local function same_origin()
  local cfg = config.get()
  if not cfg.require_same_origin then return true end
  local site = ngx.var.http_sec_fetch_site
  if site then return site == "same-origin" end
  local origin = ngx.var.http_origin
  if origin then return origin_is_self(origin) end
  return cfg.allow_non_browser
end

--- Shared checks; returns the parsed target and the upstream address.
local function prepare(raw_url, allowed_schemes)
  local cfg = config.get()
  if not limit.check(cfg.rate_limit) then
    return fail(429, "RATE_LIMITED", "Too many requests. Slow down a little.")
  end
  if not same_origin() then
    return fail(403, "FORBIDDEN_ORIGIN", "Transport requests must come from this server's own pages.")
  end
  local target, err = url.parse(raw_url)
  if not target then return fail(400, "INVALID_URL", err) end
  if not allowed_schemes[target.scheme] then
    return fail(400, "INVALID_URL", "Unsupported scheme " .. target.scheme .. ".")
  end
  local dest, code, message = guard.check(target)
  if not dest then return fail(code == "DNS_FAILURE" and 502 or 403, code, message) end
  return target, dest
end

local function set_upstream(scheme, target, dest)
  ngx.var.butter_scheme = scheme
  ngx.var.butter_addr = dest.addr
  ngx.var.butter_uri = target.path
  ngx.var.butter_host = target.host_header
  ngx.var.butter_sni = target.host
end

--- Remove every incoming header except the ones in `keep`.
local function clear_request_headers(keep)
  for name in pairs(ngx.req.get_headers(200, true)) do
    if not keep[name:lower()] then ngx.req.clear_header(name) end
  end
end

local function apply_cookie(sid, target)
  if not config.get().cookies.enabled then return end
  local cookie = store.cookie_header(sid, target)
  if cookie ~= "" then ngx.req.set_header("Cookie", cookie) end
end

local HTTP_SCHEMES = { http = true, https = true }
local WS_SCHEMES = { ws = true, wss = true }

-- /butter/fetch ---------------------------------------------------------------

function M.access_fetch()
  local target, dest = prepare(ngx.var.http_x_butter_url, HTTP_SCHEMES)
  if not target then return end

  local decoded = cjson.decode(ngx.var.http_x_butter_headers or "{}")
  local list, err = headers.sanitize_request(decoded)
  if not list then return fail(400, "INVALID_HEADERS", err) end

  local want_cookies = ngx.var.http_x_butter_want_cookies == "1"
  local sid, new_session = session.get()

  clear_request_headers(headers.KEEP_OUTER)
  for _, header in ipairs(list) do
    ngx.req.set_header(header[1], header[2])
  end
  local cfg = config.get()
  if cfg.user_agent then ngx.req.set_header("User-Agent", cfg.user_agent) end
  apply_cookie(sid, target)

  set_upstream(target.scheme, target, dest)
  ngx.ctx.butter = { sid = sid, new_session = new_session, target = target, want_cookies = want_cookies }
end

--- Collect upstream Set-Cookie headers into the jar.
local function capture_cookies(ctx, values)
  if #values > 0 and config.get().cookies.enabled then
    store.set_cookies(ctx.sid, ctx.target, values)
  end
end

function M.header_filter_fetch()
  local ctx = ngx.ctx.butter
  if not ctx then return end

  local status = ngx.status
  local reported, cookies = {}, {}
  for name, value in pairs(ngx.resp.get_headers(200, true)) do
    local lower = name:lower()
    local values = type(value) == "table" and value or { value }
    if lower == "set-cookie" then
      for _, v in ipairs(values) do cookies[#cookies + 1] = v end
    elseif not headers.RESPONSE_SKIP[lower] then
      for _, v in ipairs(values) do reported[#reported + 1] = { name, v } end
    end
    if not headers.OUTER_KEEP[lower] then ngx.header[name] = nil end
  end
  capture_cookies(ctx, cookies)

  -- The real status travels in a header: a 3xx would make the browser follow
  -- the redirect itself, and a 401 would pop up an auth dialog.
  ngx.status = ngx.HTTP_OK
  ngx.header["X-Butter-Status"] = tostring(status)
  ngx.header["X-Butter-Status-Text"] = headers.reason(status)
  ngx.header["X-Butter-Headers"] = #reported == 0 and "[]" or cjson.encode(reported)
  ngx.header["Content-Type"] = "application/octet-stream"
  ngx.header["Cache-Control"] = "no-store"
  if ctx.want_cookies then
    ngx.header["X-Butter-Document-Cookies"] = store.document_cookie(ctx.sid, ctx.target)
  end
  if ctx.new_session then ngx.header["Set-Cookie"] = session.cookie(ctx.sid) end
end

-- /butter/ws -------------------------------------------------------------------

function M.access_ws()
  if (ngx.var.http_upgrade or ""):lower() ~= "websocket" then
    return fail(400, "NOT_WEBSOCKET", "Expected a WebSocket upgrade request.")
  end
  local args = ngx.req.get_uri_args(10)
  local raw_url = type(args.url) == "string" and args.url or nil
  local target, dest = prepare(raw_url, WS_SCHEMES)
  if not target then return end

  -- Origin the target site should see: the proxied page's own origin.
  local page_origin = type(args.origin) == "string" and url.parse(args.origin .. "/")
  local origin = page_origin and HTTP_SCHEMES[page_origin.scheme] and page_origin.origin
    or ((target.secure and "https://" or "http://") .. target.host_header)

  local sid, new_session = session.get()
  for _, name in ipairs({ "Cookie", "Origin", "Referer", "X-Forwarded-For", "X-Real-IP", "Forwarded" }) do
    ngx.req.clear_header(name)
  end
  ngx.req.set_header("Origin", origin)
  local cfg = config.get()
  if cfg.user_agent then ngx.req.set_header("User-Agent", cfg.user_agent) end
  apply_cookie(sid, target)

  set_upstream(target.secure and "https" or "http", target, dest)
  ngx.ctx.butter = { sid = sid, new_session = new_session, target = target }
end

function M.header_filter_ws()
  local ctx = ngx.ctx.butter
  if not ctx then return end
  local values = ngx.header["Set-Cookie"]
  if values then
    capture_cookies(ctx, type(values) == "table" and values or { values })
    ngx.header["Set-Cookie"] = nil
  end
  if ctx.new_session then ngx.header["Set-Cookie"] = session.cookie(ctx.sid) end
end

-- Errors from nginx's proxy module (connection refused, TLS failure, timeout).
function M.upstream_error()
  local status = ngx.status
  if status == 504 then
    return fail(504, "UPSTREAM_TIMEOUT", "The site took too long to respond.")
  end
  return fail(502, "UPSTREAM_UNREACHABLE", "Could not connect to the site (connection refused or reset, or its TLS certificate could not be verified).")
end

-- /butter/cookie ---------------------------------------------------------------

function M.cookie()
  if ngx.req.get_method() ~= "POST" then return fail(405, "METHOD_NOT_ALLOWED", "Use POST.") end
  if not same_origin() then return fail(403, "FORBIDDEN_ORIGIN", "Cross-site cookie writes are not allowed.") end
  if not config.get().cookies.enabled then return ngx.exit(ngx.HTTP_NO_CONTENT) end

  ngx.req.read_body()
  local data = cjson.decode(ngx.req.get_body_data() or "")
  if type(data) ~= "table" or type(data.url) ~= "string" or type(data.cookie) ~= "string" or #data.cookie > 4096 then
    return fail(400, "INVALID_COOKIE", "Expected {\"url\": string, \"cookie\": string}.")
  end
  local target, err = url.parse(data.url)
  if not target or not HTTP_SCHEMES[target.scheme] then return fail(400, "INVALID_URL", err or "Unsupported scheme.") end

  local sid = session.ensure()
  store.set_cookies(sid, target, { data.cookie }, { from_script = true })
  return ngx.exit(ngx.HTTP_NO_CONTENT)
end

-- /butter/config.js ------------------------------------------------------------

function M.config_js()
  -- Handing out the session cookie here (the service worker imports this
  -- script on install) means it exists before the first proxied request.
  session.ensure()
  ngx.header["Content-Type"] = "text/javascript; charset=utf-8"
  ngx.header["Cache-Control"] = "no-cache"
  ngx.say("self.__butter$config = ", cjson.encode(config.public()), ";")
end

-- /butter/health ---------------------------------------------------------------

function M.health()
  ngx.header["Content-Type"] = "application/json"
  ngx.header["Cache-Control"] = "no-store"
  ngx.say(cjson.encode({ ok = true, name = "butter-col", version = config.VERSION }))
end

return M
