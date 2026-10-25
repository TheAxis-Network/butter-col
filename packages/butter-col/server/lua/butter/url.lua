-- Strict parser for the absolute URLs the service worker sends.
-- Pure Lua (5.1 / LuaJIT / 5.3), no ngx dependency.

local M = {}

local DEFAULT_PORTS = { http = 80, https = 443, ws = 80, wss = 443 }
local SECURE = { https = true, wss = true }

--- Parse an absolute http(s)/ws(s) URL.
-- @return table|nil, string|nil  parsed URL, or nil and an error message
function M.parse(s)
  if type(s) ~= "string" or s == "" then return nil, "missing URL" end
  if #s > 8192 then return nil, "URL is too long" end
  -- URL.href from the browser is always ASCII without spaces or controls;
  -- anything else could smuggle CR/LF into the upstream request line.
  if s:find("%c") or s:find(" ", 1, true) or s:find("[\128-\255]") then
    return nil, "URL contains invalid characters"
  end

  local scheme, rest = s:match("^(%a[%w+.-]*)://(.*)$")
  if not scheme then return nil, "not an absolute URL" end
  scheme = scheme:lower()
  local default_port = DEFAULT_PORTS[scheme]
  if not default_port then return nil, "unsupported scheme: " .. scheme end

  local authority, path = rest:match("^([^/?#]*)(.*)$")
  path = path:gsub("#.*$", "")
  if path == "" then
    path = "/"
  elseif path:sub(1, 1) == "?" then
    path = "/" .. path
  end
  if path:sub(1, 1) ~= "/" then return nil, "invalid path" end

  if authority:find("@", 1, true) then return nil, "credentials in URLs are not allowed" end

  local host, port, ipv6
  if authority:sub(1, 1) == "[" then
    host, port = authority:match("^%[([%x:%.]+)%]:?(%d*)$")
    if not host then return nil, "invalid IPv6 host" end
    ipv6 = true
  else
    host, port = authority:match("^([^:]+):?(%d*)$")
    if not host then return nil, "invalid host" end
    host = host:gsub("%.$", "")
    if host == "" or #host > 253 or not host:match("^[%w%-%._]+$") then
      return nil, "invalid host"
    end
  end
  host = host:lower()

  local port_num = default_port
  if port ~= "" then
    port_num = tonumber(port)
    if not port_num or port_num < 1 or port_num > 65535 then return nil, "invalid port" end
  end

  local host_header = ipv6 and ("[" .. host .. "]") or host
  if port_num ~= default_port then host_header = host_header .. ":" .. string.format("%d", port_num) end

  return {
    scheme = scheme,
    host = host,
    port = port_num,
    path = path,                       -- path and query, percent-encoded
    ipv6 = ipv6 or false,
    secure = SECURE[scheme] or false,
    host_header = host_header,         -- value for the Host header
    origin = scheme .. "://" .. host_header,
  }
end

--- Path without the query string.
function M.path_only(path)
  return (path:gsub("%?.*$", ""))
end

return M
