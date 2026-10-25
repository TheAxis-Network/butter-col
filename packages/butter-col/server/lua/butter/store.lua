-- Cookie jar storage: one JSON list per session in a shared dict.

local cjson = require "cjson.safe"
local jar = require "butter.cookiejar"
local config = require "butter.config"

local M = {}

local function dict()
  return ngx.shared.butter_cookies
end

local function load(sid)
  local raw = dict():get("jar:" .. sid)
  if not raw then return {} end
  local list = cjson.decode(raw)
  return type(list) == "table" and list or {}
end

local function save(sid, list)
  local key = "jar:" .. sid
  if #list == 0 then
    dict():delete(key)
    return
  end
  local ok, err, forcible = dict():set(key, cjson.encode(list), config.get().cookies.session_ttl)
  if not ok then
    ngx.log(ngx.ERR, "butter: cannot store cookies: ", err)
  elseif forcible then
    ngx.log(ngx.WARN, "butter: butter_cookies is full; evicting old sessions (consider a larger lua_shared_dict)")
  end
end

-- Header filters cannot yield, so resty.lock is out. A short spin on an
-- add()-based lock covers the rare case of two workers updating the same
-- session at the same instant; on timeout we proceed anyway.
local function with_lock(sid, fn)
  local key = "lock:" .. sid
  local locked = false
  for _ = 1, 500 do
    if dict():add(key, true, 0.05) then
      locked = true
      break
    end
  end
  local ok, err = pcall(fn)
  if locked then dict():delete(key) end
  if not ok then ngx.log(ngx.ERR, "butter: cookie store error: ", err) end
end

--- Store Set-Cookie values received from (or written by scripts for) `target`.
function M.set_cookies(sid, target, values, opts)
  local now = ngx.time()
  local max = config.get().cookies.max_per_session
  with_lock(sid, function()
    local list = load(sid)
    for _, value in ipairs(values) do
      local cookie = jar.parse_set_cookie(value, target, now)
      if cookie then
        list = jar.upsert(list, cookie, now, { from_script = opts and opts.from_script, max = max })
      end
    end
    save(sid, list)
  end)
end

--- Cookie request header for `target`.
function M.cookie_header(sid, target)
  return jar.header(load(sid), target, ngx.time())
end

--- What document.cookie should return for a page at `target`.
function M.document_cookie(sid, target)
  return jar.header(load(sid), target, ngx.time(), { for_script = true })
end

return M
