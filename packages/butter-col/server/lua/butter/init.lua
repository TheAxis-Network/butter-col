-- butter-col server entry point (loaded by init_by_lua in nginx.conf).

local M = {}

--- @param config_path string|nil  user configuration; defaults to <prefix>/config.lua
function M.init(config_path)
  local config = require "butter.config"
  local cfg = config.load(config_path or (ngx.config.prefix() .. "config.lua"))
  -- Load everything now so workers share the compiled code (and so syntax
  -- errors stop nginx at startup instead of at the first request).
  require "butter.transport"
  local names = {}
  for i, entry in ipairs(cfg.transports) do names[i] = entry.name end
  ngx.log(ngx.NOTICE, "butter-col ", config.VERSION, " ready (prefix ", cfg.prefix, ", codec ", cfg.codec,
    ", transports ", table.concat(names, ","), ", default ", cfg.default_transport, ")")
end

return M
