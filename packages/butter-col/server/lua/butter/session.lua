-- Browser sessions: a random id in an HttpOnly cookie on the proxy origin
-- keys the server-side cookie jar.

local config = require "butter.config"

local M = {}

M.COOKIE = "butter_sid"

--- @return string, boolean  session id, and whether it was just created
function M.get()
  local sid = ngx.var["cookie_" .. M.COOKIE]
  if sid and #sid == 32 and sid:match("^%x+$") then return sid, false end
  local random = require "resty.random"
  local str = require "resty.string"
  local bytes = random.bytes(16, true) or random.bytes(16)
  return str.to_hex(bytes), true
end

--- Set-Cookie value for the session cookie.
function M.cookie(sid)
  local parts = {
    M.COOKIE .. "=" .. sid,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=" .. string.format("%d", config.get().cookies.session_ttl),
  }
  if ngx.var.scheme == "https" or ngx.var.http_x_forwarded_proto == "https" then
    parts[#parts + 1] = "Secure"
  end
  return table.concat(parts, "; ")
end

--- Issue the session cookie on the current response if the request had none.
function M.ensure()
  local sid, created = M.get()
  if created then ngx.header["Set-Cookie"] = M.cookie(sid) end
  return sid, created
end

return M
