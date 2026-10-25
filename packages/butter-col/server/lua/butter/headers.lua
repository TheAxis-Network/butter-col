-- Header rules for the transport. Pure Lua, no ngx dependency.

local M = {}

local function set(list)
  local s = {}
  for _, v in ipairs(list) do s[v] = true end
  return s
end

-- Headers from the browser's own request to /butter/fetch that are forwarded
-- upstream as-is (everything else is replaced by X-Butter-Headers).
M.KEEP_OUTER = set({ "user-agent", "accept-language", "accept-encoding", "content-length", "transfer-encoding" })

-- Never accepted from X-Butter-Headers.
M.REQUEST_FORBIDDEN = set({
  "host", "connection", "keep-alive", "proxy-connection", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "content-length", "cookie", "cookie2", "expect",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "via",
  "user-agent", "accept-encoding",
})

-- Upstream response headers not reported in X-Butter-Headers.
M.RESPONSE_SKIP = set({ "connection", "keep-alive", "transfer-encoding", "proxy-connection", "trailer", "upgrade" })

-- Upstream response headers kept on the outer response so the browser
-- decodes the body before the service worker sees it.
M.OUTER_KEEP = set({ "content-encoding", "content-length" })

M.MAX_HEADERS = 100
M.MAX_VALUE = 16384

function M.valid_name(name)
  return type(name) == "string" and #name <= 256 and name:match("^[!#$%%&'*+%-%.%^_`|~%w]+$") ~= nil
end

function M.valid_value(value)
  return type(value) == "string" and #value <= M.MAX_VALUE
    and not value:find("[\r\n]") and not value:find("\0", 1, true)
end

--- Validate the decoded X-Butter-Headers object.
-- @return table|nil, string|nil  list of { name, value }
function M.sanitize_request(decoded)
  if type(decoded) ~= "table" then return nil, "headers must be a JSON object" end
  local out, count = {}, 0
  for name, value in pairs(decoded) do
    if not M.valid_name(name) then return nil, "invalid header name" end
    if not M.valid_value(value) then return nil, "invalid value for header " .. name end
    local lower = name:lower()
    if not M.REQUEST_FORBIDDEN[lower] and lower:sub(1, 9) ~= "x-butter-" then
      count = count + 1
      if count > M.MAX_HEADERS then return nil, "too many headers" end
      out[#out + 1] = { name, value }
    end
  end
  table.sort(out, function(a, b) return a[1] < b[1] end)
  return out
end

M.REASONS = {
  [100] = "Continue", [101] = "Switching Protocols",
  [200] = "OK", [201] = "Created", [202] = "Accepted", [203] = "Non-Authoritative Information",
  [204] = "No Content", [205] = "Reset Content", [206] = "Partial Content",
  [300] = "Multiple Choices", [301] = "Moved Permanently", [302] = "Found", [303] = "See Other",
  [304] = "Not Modified", [307] = "Temporary Redirect", [308] = "Permanent Redirect",
  [400] = "Bad Request", [401] = "Unauthorized", [402] = "Payment Required", [403] = "Forbidden",
  [404] = "Not Found", [405] = "Method Not Allowed", [406] = "Not Acceptable", [407] = "Proxy Authentication Required",
  [408] = "Request Timeout", [409] = "Conflict", [410] = "Gone", [411] = "Length Required",
  [412] = "Precondition Failed", [413] = "Content Too Large", [414] = "URI Too Long",
  [415] = "Unsupported Media Type", [416] = "Range Not Satisfiable", [417] = "Expectation Failed",
  [418] = "I'm a teapot", [421] = "Misdirected Request", [422] = "Unprocessable Content", [425] = "Too Early",
  [426] = "Upgrade Required", [428] = "Precondition Required", [429] = "Too Many Requests",
  [431] = "Request Header Fields Too Large", [451] = "Unavailable For Legal Reasons",
  [500] = "Internal Server Error", [501] = "Not Implemented", [502] = "Bad Gateway",
  [503] = "Service Unavailable", [504] = "Gateway Timeout", [505] = "HTTP Version Not Supported",
}

function M.reason(status)
  return M.REASONS[status] or ""
end

return M
