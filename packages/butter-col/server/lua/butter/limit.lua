-- Fixed-window rate limiter per client address.

local M = {}

--- @return boolean  true if the request may proceed
function M.check(cfg)
  if not cfg or not cfg.enabled then return true end
  local window = cfg.window
  local key = ngx.var.binary_remote_addr .. ":" .. math.floor(ngx.now() / window)
  local count, err = ngx.shared.butter_limit:incr(key, 1, 0, window)
  if not count then
    ngx.log(ngx.WARN, "butter: rate limiter unavailable: ", err)
    return true
  end
  return count <= cfg.requests
end

return M
