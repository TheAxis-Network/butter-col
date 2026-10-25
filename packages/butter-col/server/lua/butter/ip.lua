-- IPv4 / IPv6 parsing and reserved-range checks for SSRF protection.
-- Pure Lua (5.1 / LuaJIT / 5.3) without bit operators: addresses are byte arrays.

local M = {}

--- Parse dotted-quad IPv4. Rejects octal-looking parts like "010".
-- @return table|nil  4 bytes
function M.parse_v4(s)
  local parts = { s:match("^(%d+)%.(%d+)%.(%d+)%.(%d+)$") }
  if #parts ~= 4 then return nil end
  local bytes = {}
  for i = 1, 4 do
    local p = parts[i]
    if #p > 3 or (#p > 1 and p:sub(1, 1) == "0") then return nil end
    local n = tonumber(p)
    if n > 255 then return nil end
    bytes[i] = n
  end
  return bytes
end

local function parse_groups(s)
  local groups = {}
  if s == "" then return groups end
  for group in (s .. ":"):gmatch("([^:]*):") do
    if not group:match("^%x%x?%x?%x?$") then return nil end
    groups[#groups + 1] = tonumber(group, 16)
  end
  return groups
end

--- Parse IPv6 (with optional embedded IPv4 tail). Zone ids are rejected.
-- @return table|nil  16 bytes
function M.parse_v6(s)
  if s:find("%", 1, true) then return nil end
  local v4_tail
  local last_colon = s:match("^.*():")
  if last_colon and s:find(".", last_colon, true) then
    v4_tail = M.parse_v4(s:sub(last_colon + 1))
    if not v4_tail then return nil end
    s = s:sub(1, last_colon)
    if s:sub(-2) ~= "::" then s = s:sub(1, -2) end
  end

  local head, tail = s:match("^(.-)::(.*)$")
  local groups
  local extra = v4_tail and 2 or 0
  if head then
    if tail:find("::", 1, true) then return nil end
    local h, t = parse_groups(head), parse_groups(tail)
    if not h or not t then return nil end
    local missing = 8 - extra - #h - #t
    if missing < 1 then return nil end
    groups = h
    for _ = 1, missing do groups[#groups + 1] = 0 end
    for _, g in ipairs(t) do groups[#groups + 1] = g end
  else
    groups = parse_groups(s)
    if not groups or #groups ~= 8 - extra then return nil end
  end

  local bytes = {}
  for _, g in ipairs(groups) do
    bytes[#bytes + 1] = math.floor(g / 256)
    bytes[#bytes + 1] = g % 256
  end
  if v4_tail then
    for i = 1, 4 do bytes[#bytes + 1] = v4_tail[i] end
  end
  return bytes
end

--- @return table|nil, number|nil  bytes and version (4 or 6)
function M.parse(s)
  if type(s) ~= "string" then return nil end
  local v4 = M.parse_v4(s)
  if v4 then return v4, 4 end
  if s:find(":", 1, true) then
    local v6 = M.parse_v6(s)
    if v6 then return v6, 6 end
  end
  return nil
end

--- Does `bytes` fall inside network/bits?
function M.in_cidr(bytes, network, bits)
  for i = 1, #network do
    if bits <= 0 then return true end
    if bits >= 8 then
      if bytes[i] ~= network[i] then return false end
      bits = bits - 8
    else
      local div = 2 ^ (8 - bits)
      return math.floor(bytes[i] / div) == math.floor(network[i] / div)
    end
  end
  return true
end

--- Compile CIDR strings into { bytes, bits, version } entries.
function M.compile(list)
  local out = {}
  for _, cidr in ipairs(list) do
    local addr, bits = cidr:match("^(.-)/(%d+)$")
    local bytes, version = M.parse(addr or cidr)
    if not bytes then error("invalid CIDR: " .. tostring(cidr)) end
    out[#out + 1] = { bytes = bytes, bits = tonumber(bits) or (#bytes * 8), version = version }
  end
  return out
end

M.RESERVED = M.compile({
  -- IPv4
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
  "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
  "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
  -- IPv6
  "::/128", "::1/128", "100::/64", "2001::/23", "2001:db8::/32", "fc00::/7",
  "fe80::/10", "fec0::/10", "ff00::/8",
})

local function embedded_v4(bytes)
  -- ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64)
  local zero10 = true
  for i = 1, 10 do
    if bytes[i] ~= 0 then zero10 = false break end
  end
  if zero10 and ((bytes[11] == 255 and bytes[12] == 255) or (bytes[11] == 0 and bytes[12] == 0)) then
    return { bytes[13], bytes[14], bytes[15], bytes[16] }
  end
  if bytes[1] == 0 and bytes[2] == 0x64 and bytes[3] == 0xff and bytes[4] == 0x9b then
    return { bytes[13], bytes[14], bytes[15], bytes[16] }
  end
  -- 2002:AABB:CCDD::/48 (6to4)
  if bytes[1] == 0x20 and bytes[2] == 0x02 then
    return { bytes[3], bytes[4], bytes[5], bytes[6] }
  end
  return nil
end

--- Is the address private, loopback, link-local, multicast or otherwise reserved?
function M.is_reserved(bytes, version)
  for _, net in ipairs(M.RESERVED) do
    if net.version == version and M.in_cidr(bytes, net.bytes, net.bits) then return true end
  end
  if version == 6 then
    local v4 = embedded_v4(bytes)
    if v4 then return M.is_reserved(v4, 4) end
  end
  return false
end

--- Canonical text form (IPv6 uncompressed), suitable for nginx proxy_pass.
function M.to_string(bytes, version)
  if version == 4 then
    return string.format("%d.%d.%d.%d", bytes[1], bytes[2], bytes[3], bytes[4])
  end
  local groups = {}
  for i = 1, 16, 2 do
    groups[#groups + 1] = string.format("%x", bytes[i] * 256 + bytes[i + 1])
  end
  return table.concat(groups, ":")
end

return M
