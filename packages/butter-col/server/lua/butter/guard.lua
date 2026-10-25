-- Decides whether a target may be proxied and which address to connect to.

local config = require "butter.config"
local dns = require "butter.dns"
local ip = require "butter.ip"

local M = {}

-- Ports browsers refuse to fetch (https://fetch.spec.whatwg.org/#bad-port).
local BAD_PORTS = {}
for _, port in ipairs({
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
}) do
  BAD_PORTS[port] = true
end

--- Does `host` equal `pattern` or sit under it?
local function host_matches(host, pattern)
  pattern = pattern:lower():gsub("^%*?%.", "")
  return host == pattern or (#host > #pattern and host:sub(-#pattern - 1) == "." .. pattern)
end

local function matches_any(host, list)
  for _, pattern in ipairs(list or {}) do
    if host_matches(host, pattern) then return true end
  end
  return false
end

--- Check a parsed target (butter.url) and pick the upstream address.
-- @return table|nil, string|nil, string|nil  { addr = "ip:port", ip = "ip" } or nil, code, message
function M.check(target)
  local cfg = config.get()
  local g = cfg.guard

  if BAD_PORTS[target.port] and not g.allow_bad_ports then
    return nil, "BLOCKED_PORT", "Port " .. target.port .. " is not allowed."
  end
  if matches_any(target.host, g.blocked_hosts) then
    return nil, "BLOCKED_HOST", target.host .. " is blocked on this server."
  end
  if g.allowed_hosts and not matches_any(target.host, g.allowed_hosts) then
    return nil, "BLOCKED_HOST", target.host .. " is not on this server's allow list."
  end

  local addrs
  local literal, version = ip.parse(target.host)
  if literal then
    addrs = { { bytes = literal, version = version } }
  elseif target.ipv6 then
    return nil, "INVALID_URL", "Invalid IPv6 address."
  else
    local err
    addrs, err = dns.resolve(target.host, cfg.dns)
    if not addrs then
      return nil, "DNS_FAILURE", "Could not resolve " .. target.host .. " (" .. tostring(err) .. ")."
    end
  end

  if not g.allow_private then
    for _, a in ipairs(addrs) do
      if ip.is_reserved(a.bytes, a.version) then
        return nil, "BLOCKED_ADDRESS", target.host .. " points to a private or reserved address."
      end
    end
  end

  local chosen = addrs[1]
  local text = ip.to_string(chosen.bytes, chosen.version)
  local host = chosen.version == 6 and ("[" .. text .. "]") or text
  return { addr = host .. ":" .. target.port, ip = text }
end

return M
