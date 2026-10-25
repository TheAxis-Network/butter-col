-- DNS resolution with a shared cache. The proxy connects to the address it
-- resolved and checked here, so DNS rebinding cannot slip past the guard.

local resolver = require "resty.dns.resolver"
local ip = require "butter.ip"

local M = {}

local function decode(cached)
  local out = {}
  for text in cached:gmatch("[^,]+") do
    local bytes, version = ip.parse(text)
    if bytes then out[#out + 1] = { bytes = bytes, version = version } end
  end
  return out
end

local function query(r, host, qtype)
  local answers, err = r:query(host, { qtype = qtype })
  if not answers then return nil, err end
  if answers.errcode then return nil, answers.errstr or ("DNS error " .. answers.errcode) end
  local addrs, ttl = {}, nil
  for _, answer in ipairs(answers) do
    if answer.type == qtype and answer.address then
      addrs[#addrs + 1] = answer.address
      ttl = ttl and math.min(ttl, answer.ttl or ttl) or answer.ttl
    end
  end
  return addrs, nil, ttl
end

--- Resolve `host` to a list of { bytes, version }.
-- @return table|nil, string|nil
function M.resolve(host, cfg)
  local cache = ngx.shared.butter_dns
  local cached = cache:get(host)
  if cached then
    if cached:sub(1, 1) == "!" then return nil, cached:sub(2) end
    return decode(cached)
  end

  local r, err = resolver:new({ nameservers = cfg.nameservers, retrans = cfg.retrans, timeout = cfg.timeout })
  if not r then return nil, "cannot create resolver: " .. tostring(err) end

  local addrs, qerr, ttl = query(r, host, r.TYPE_A)
  if (not addrs or #addrs == 0) and cfg.ipv6 then
    local addrs6, qerr6, ttl6 = query(r, host, r.TYPE_AAAA)
    if addrs6 and #addrs6 > 0 then
      addrs, ttl = addrs6, ttl6
    else
      qerr = qerr or qerr6
    end
  end

  if not addrs or #addrs == 0 then
    local message = qerr or "no addresses found"
    cache:set(host, "!" .. message, cfg.negative_ttl)
    return nil, message
  end

  ttl = math.max(cfg.min_ttl, math.min(cfg.max_ttl, ttl or cfg.min_ttl))
  local text = table.concat(addrs, ",")
  cache:set(host, text, ttl)
  return decode(text)
end

return M
