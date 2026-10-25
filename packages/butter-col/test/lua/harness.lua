-- Minimal test harness for the pure Lua modules.

local T = { passed = 0, failed = 0 }

local function show(v)
  if type(v) == "string" then return string.format("%q", v) end
  return tostring(v)
end

function T.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    T.passed = T.passed + 1
    print("  ok    " .. name)
  else
    T.failed = T.failed + 1
    print("  FAIL  " .. name .. "\n        " .. tostring(err))
  end
end

function T.eq(actual, expected, label)
  if actual ~= expected then
    error((label and (label .. ": ") or "") .. "expected " .. show(expected) .. ", got " .. show(actual), 2)
  end
end

function T.ok(value, label)
  if not value then error((label or "expected a truthy value") .. ", got " .. show(value), 2) end
end

function T.no(value, label)
  if value then error((label or "expected a falsy value") .. ", got " .. show(value), 2) end
end

return T
