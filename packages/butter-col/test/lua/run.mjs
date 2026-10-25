// Runs the Lua unit tests for the pure server modules (no nginx needed).
// Uses fengari (Lua 5.3 in JavaScript); the modules are written to run on
// both Lua 5.3 and LuaJIT, which OpenResty uses.
import fengari from "fengari";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
const root = fileURLToPath(new URL("../..", import.meta.url));
const luaPath = (p) => path.join(root, p).replace(/\\/g, "/");

const L = lauxlib.luaL_newstate();
lualib.luaL_openlibs(L);

const packagePath = [
  luaPath("server/lua/?.lua"),
  luaPath("server/lua/?/init.lua"),
  luaPath("test/lua/?.lua"),
].join(";");

// fengari has no io library, so fixtures are written from here.
const fixtureDir = mkdtempSync(path.join(tmpdir(), "butter-lua-"));
const fixture = path.join(fixtureDir, "config.lua").replace(/\\/g, "/");
writeFileSync(fixture, 'return { codec = "xor", guard = {}, dns = { nameservers = { "9.9.9.9" } } }');
const badTransport = path.join(fixtureDir, "bad-transport.lua").replace(/\\/g, "/");
writeFileSync(badTransport, 'return { transports = { { name = "bare" } }, default_transport = "butter" }');
process.on("exit", () => rmSync(fixtureDir, { recursive: true, force: true }));

const script = `
package.path = ${JSON.stringify(packagePath)}
CONFIG_FIXTURE = ${JSON.stringify(fixture)}
CONFIG_FIXTURE_BAD_TRANSPORT = ${JSON.stringify(badTransport)}
local T = dofile(${JSON.stringify(luaPath("test/lua/test_modules.lua"))})
print(string.format("\\n%d passed, %d failed", T.passed, T.failed))
return T.failed
`;

if (lauxlib.luaL_loadstring(L, to_luastring(script)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
  console.error(to_jsstring(lua.lua_tostring(L, -1)));
  process.exit(1);
}
process.exit(lua.lua_tointeger(L, -1) === 0 ? 0 : 1);
