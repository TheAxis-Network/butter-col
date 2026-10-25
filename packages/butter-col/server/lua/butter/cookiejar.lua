-- Server-side cookie jar logic (RFC 6265 subset). Pure Lua, no ngx dependency:
-- storage lives in butter.store; this module only transforms cookie lists.
--
-- A cookie is a table:
--   { name, value, domain, host_only, path, secure, http_only, same_site,
--     expires (epoch seconds or nil for session cookies), created }

local url_util = require "butter.url"

local M = {}

local function trim(s)
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

local MONTHS = { jan = 1, feb = 2, mar = 3, apr = 4, may = 5, jun = 6, jul = 7, aug = 8, sep = 9, oct = 10, nov = 11, dec = 12 }

local function days_from_civil(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = (m + 9) % 12
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

--- Parse a cookie date (RFC 6265 section 5.1.1). Returns epoch seconds or nil.
function M.parse_date(s)
  local hour, minute, second, day, month, year
  for token in s:gmatch("[^%s,;%-/]+") do
    local h, mi, se = token:match("^(%d%d?):(%d%d?):(%d%d?)")
    if h and not hour then
      hour, minute, second = tonumber(h), tonumber(mi), tonumber(se)
    elseif not day and token:match("^%d%d?$") then
      day = tonumber(token)
    elseif not month and MONTHS[token:sub(1, 3):lower()] then
      month = MONTHS[token:sub(1, 3):lower()]
    elseif not year and token:match("^%d%d%d?%d?$") then
      year = tonumber(token)
    end
  end
  if not (hour and day and month and year) then return nil end
  if year >= 70 and year <= 99 then year = year + 1900 elseif year < 70 then year = year + 2000 end
  if day < 1 or day > 31 or year < 1601 or hour > 23 or minute > 59 or second > 59 then return nil end
  return days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second
end

--- Default-path of a request path (RFC 6265 section 5.1.4).
function M.default_path(path)
  path = url_util.path_only(path or "/")
  if path:sub(1, 1) ~= "/" then return "/" end
  local last = path:match("^.*()/")
  if not last or last == 1 then return "/" end
  return path:sub(1, last - 1)
end

local function is_ip(host)
  return host:match("^%d+%.%d+%.%d+%.%d+$") ~= nil or host:find(":", 1, true) ~= nil
end

function M.domain_match(host, domain)
  if host == domain then return true end
  if is_ip(host) then return false end
  return #host > #domain and host:sub(-#domain - 1) == "." .. domain
end

function M.path_match(request_path, cookie_path)
  if request_path == cookie_path then return true end
  if request_path:sub(1, #cookie_path) ~= cookie_path then return false end
  return cookie_path:sub(-1) == "/" or request_path:sub(#cookie_path + 1, #cookie_path + 1) == "/"
end

--- Parse one Set-Cookie header received from `target` (a butter.url table).
-- @return table|nil, string|nil
function M.parse_set_cookie(header, target, now)
  if type(header) ~= "string" then return nil, "not a string" end
  local pair, attrs = header:match("^([^;]*)(.*)$")
  local name, value
  local eq = pair:find("=", 1, true)
  if eq then
    name, value = trim(pair:sub(1, eq - 1)), trim(pair:sub(eq + 1))
  else
    name, value = "", trim(pair)
  end
  if name == "" and value == "" then return nil, "empty cookie" end
  if #name + #value > 4096 then return nil, "cookie too large" end
  if (name .. value):find("%c") then return nil, "control characters in cookie" end

  local cookie = { name = name, value = value, secure = false, http_only = false }
  local max_age, expires, domain, path
  for attr in attrs:gmatch(";([^;]*)") do
    local k, v = attr:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
    if not k then
      k, v = trim(attr), ""
    end
    k = k:lower()
    if k == "expires" then
      expires = M.parse_date(v) or expires
    elseif k == "max-age" then
      if v:match("^%-?%d+$") then max_age = tonumber(v) end
    elseif k == "domain" then
      v = v:gsub("^%.", ""):lower()
      if v ~= "" then domain = v end
    elseif k == "path" then
      if v:sub(1, 1) == "/" then path = v end
    elseif k == "secure" then
      cookie.secure = true
    elseif k == "httponly" then
      cookie.http_only = true
    elseif k == "samesite" then
      cookie.same_site = v:lower()
    end
  end

  if max_age then
    cookie.expires = max_age <= 0 and 0 or now + max_age
  elseif expires then
    cookie.expires = expires
  end

  local host = target.host
  if domain then
    if not M.domain_match(host, domain) then return nil, "domain does not match" end
    -- Without a public suffix list, at least refuse single-label domains ("com").
    if domain ~= host and not domain:find(".", 1, true) then return nil, "domain too broad" end
    cookie.domain, cookie.host_only = domain, false
  else
    cookie.domain, cookie.host_only = host, true
  end
  cookie.path = path or M.default_path(target.path)

  if cookie.secure and not target.secure then return nil, "secure cookie from insecure origin" end
  if name:sub(1, 9) == "__Secure-" and not cookie.secure then return nil, "__Secure- prefix requires Secure" end
  if name:sub(1, 7) == "__Host-" and not (cookie.secure and cookie.host_only and cookie.path == "/") then
    return nil, "__Host- prefix requirements not met"
  end
  return cookie
end

--- Insert or replace `cookie` in `list`, dropping expired entries.
-- opts.from_script: the cookie comes from document.cookie (cannot touch HttpOnly)
-- opts.max: maximum cookies kept (oldest are evicted)
-- @return table  the new list
function M.upsert(list, cookie, now, opts)
  opts = opts or {}
  if opts.from_script and cookie.http_only then return list end
  local out, created = {}, nil
  for _, c in ipairs(list) do
    if c.expires and c.expires <= now then
      -- expired: drop
    elseif c.name == cookie.name and c.domain == cookie.domain and c.path == cookie.path then
      if opts.from_script and c.http_only then return list end
      created = c.created
    else
      out[#out + 1] = c
    end
  end
  cookie.created = created or now
  if not (cookie.expires and cookie.expires <= now) then out[#out + 1] = cookie end

  local max = opts.max or 500
  if #out > max then
    table.sort(out, function(a, b) return (a.created or 0) > (b.created or 0) end)
    for i = #out, max + 1, -1 do out[i] = nil end
  end
  return out
end

--- Cookie header value for a request to `target`.
-- opts.for_script: only cookies visible to document.cookie (no HttpOnly)
function M.header(list, target, now, opts)
  local for_script = opts and opts.for_script
  local path = url_util.path_only(target.path)
  local matches = {}
  for _, c in ipairs(list) do
    if not (c.expires and c.expires <= now)
      and ((c.host_only and c.domain == target.host) or (not c.host_only and M.domain_match(target.host, c.domain)))
      and M.path_match(path, c.path)
      and (not c.secure or target.secure)
      and not (for_script and c.http_only)
    then
      matches[#matches + 1] = c
    end
  end
  table.sort(matches, function(a, b)
    if #a.path ~= #b.path then return #a.path > #b.path end
    return (a.created or 0) < (b.created or 0)
  end)
  local parts = {}
  for i, c in ipairs(matches) do
    parts[i] = c.name ~= "" and (c.name .. "=" .. c.value) or c.value
  end
  return table.concat(parts, "; ")
end

return M
