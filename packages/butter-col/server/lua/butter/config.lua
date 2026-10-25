-- Configuration: defaults merged with server/config.lua (if present).

local M = {}

M.VERSION = "0.1.0"

local CODECS = { none = true, plain = true, xor = true, base64 = true }

local defaults = {
  -- Where butter-col's own endpoints and assets live. The nginx locations in
  -- conf/nginx.conf use this path too; change both together.
  base = "/butter/",
  -- Prefix of proxied URLs; must live under `base` (see the bootstrap location).
  prefix = "/butter/go/",
  -- URL codec: "none" | "plain" | "xor" | "base64"
  codec = "plain",

  -- Transports offered to browsers. Each entry: { name, url?, options? }.
  -- `url` defaults to <base>transports/<name>.js; `options` is sent to the
  -- transport's factory as JSON. Visitors can switch between these with
  -- ButterController.setTransport().
  transports = {
    { name = "butter" },
  },
  -- Used until a visitor picks another one.
  default_transport = "butter",

  -- Reject transport requests that a browser marks as cross-site, so other
  -- websites cannot use visitors' browsers to drive the proxy.
  require_same_origin = true,
  -- Allow clients that send neither Sec-Fetch-Site nor Origin (curl, scripts).
  allow_non_browser = true,
  -- Override the upstream User-Agent (nil forwards the browser's own).
  user_agent = nil,

  dns = {
    nameservers = { "1.1.1.1", "8.8.8.8" },
    timeout = 2000,     -- ms per attempt
    retrans = 2,
    ipv6 = false,       -- also look up AAAA records when there is no A record
    min_ttl = 30,
    max_ttl = 3600,
    negative_ttl = 30,
  },

  guard = {
    -- Allow upstream connections to private / loopback / link-local addresses.
    -- Leave this off unless the proxy only serves you on a trusted network.
    allow_private = false,
    -- Allow the ports browsers refuse to fetch (SMTP, IRC, ...).
    allow_bad_ports = false,
    -- Hosts that may never be proxied; "example.com" also covers subdomains.
    blocked_hosts = { "localhost", "local", "internal", "localdomain", "home.arpa" },
    -- If set, only these hosts (and their subdomains) may be proxied.
    allowed_hosts = nil,
  },

  cookies = {
    enabled = true,
    max_per_session = 500,
    session_ttl = 7 * 24 * 3600, -- seconds a jar is kept after its last change
  },

  rate_limit = {
    enabled = true,
    requests = 1200,    -- per client IP ...
    window = 60,        -- ... per this many seconds
  },
}

local current

local function is_array(t)
  return type(t) == "table" and t[1] ~= nil
end

--- Deep-merge `override` into `base`. Lists (and scalars) replace wholesale.
local function merge(base, override)
  if override == nil then return base end
  if type(base) ~= "table" or type(override) ~= "table" or is_array(base) or is_array(override) then
    return override
  end
  local out = {}
  for k, v in pairs(base) do out[k] = v end
  for k, v in pairs(override) do out[k] = merge(base[k], v) end
  return out
end

local function validate(cfg)
  assert(type(cfg.base) == "string" and cfg.base:match("^/.*/$"), "config.base must start and end with '/'")
  assert(type(cfg.prefix) == "string" and cfg.prefix:match("^/.*/$"), "config.prefix must start and end with '/'")
  assert(cfg.prefix:sub(1, #cfg.base) == cfg.base and cfg.prefix ~= cfg.base, "config.prefix must live under config.base")
  assert(CODECS[cfg.codec], "config.codec must be one of none, plain, xor, base64")
  assert(type(cfg.dns.nameservers) == "table" and #cfg.dns.nameservers > 0, "config.dns.nameservers must not be empty")
  assert(cfg.rate_limit.window > 0 and cfg.rate_limit.requests > 0, "config.rate_limit values must be positive")

  assert(type(cfg.transports) == "table" and #cfg.transports > 0, "config.transports must list at least one transport")
  local seen = {}
  for i, entry in ipairs(cfg.transports) do
    assert(type(entry) == "table", "config.transports[" .. i .. "] must be a table")
    assert(type(entry.name) == "string" and entry.name:match("^[a-z0-9][a-z0-9._-]*$") and #entry.name <= 64,
      "config.transports[" .. i .. "].name must be lower-case letters, digits, '.', '_' or '-'")
    assert(not seen[entry.name], "config.transports lists \"" .. entry.name .. "\" twice")
    assert(entry.url == nil or type(entry.url) == "string", "config.transports[" .. i .. "].url must be a string")
    seen[entry.name] = true
  end
  assert(seen[cfg.default_transport], "config.default_transport must name one of config.transports")
end

--- Load defaults merged with the user file at `path` (missing file = defaults).
function M.load(path)
  local user = {}
  if path then
    local chunk, err = loadfile(path)
    if not chunk and not tostring(err):find("cannot open", 1, true) then
      error("butter: cannot parse " .. path .. ": " .. tostring(err))
    end
    if chunk then
      local ok, result = pcall(chunk)
      if not ok then error("butter: error in " .. path .. ": " .. tostring(result)) end
      if type(result) ~= "table" then error("butter: " .. path .. " must return a table") end
      user = result
    end
  end
  local cfg = merge(defaults, user)
  validate(cfg)
  current = cfg
  return cfg
end

function M.get()
  return current or M.load()
end

--- The subset sent to browsers as /butter/config.js.
function M.public()
  local cfg = M.get()
  local base = cfg.base
  local transports = {}
  for i, entry in ipairs(cfg.transports) do
    transports[i] = {
      name = entry.name,
      url = entry.url or (base .. "transports/" .. entry.name .. ".js"),
      options = entry.options,
    }
  end
  return {
    version = M.VERSION,
    prefix = cfg.prefix,
    base = base,
    codec = cfg.codec,
    transport = { fetch = base .. "fetch", ws = base .. "ws", cookie = base .. "cookie" },
    client = base .. "client.js",
    config = base .. "config.js",
    transports = transports,
    defaultTransport = cfg.default_transport,
  }
end

return M
