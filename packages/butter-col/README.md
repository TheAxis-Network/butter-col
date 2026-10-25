# @axis-network/butter-col

A service-worker web proxy with pluggable transports, a built-in frontend and an OpenResty (Lua) backend, by [Axis Network](https://github.com/TheAxis-Network). Pages opened through it run from the proxy's origin: a service worker hands every request to a transport and rewrites HTML, CSS and JavaScript on the way back.

```sh
npm install @axis-network/butter-col
npx butter-col server start            # http://localhost:8080/
```

Requires Node.js 20+. The built-in `butter` transport needs [OpenResty](https://openresty.org/) 1.21+: put it on `PATH`, set `OPENRESTY`, or on Windows unzip `openresty-<version>-win64.zip` into `.tools/`.

## The frontend

`server start` serves butter-col's frontend at `/` (and always at `/app/`):

- a search-or-address box, with your choice of search engine;
- an in-page browser with back, forward, reload, an address bar that follows the page, full screen and open-in-new-tab;
- recent sites, light and dark themes, and an "about:blank tab" option;
- a transport picker for visitors.

Pass `--site <dir>` to serve your own pages at `/` instead. They can drive the proxy with `ButterController`.

## What's inside

| Path / export | Contents |
| --- | --- |
| `dist/sw.js` | Service worker (register at `/butter/sw.js`, scope `/`) |
| `dist/client.js` | In-page runtime, injected into every proxied document and worker |
| `dist/controller.mjs` · `@axis-network/butter-col/controller` | `ButterController`: install, encode URLs, switch transports |
| `dist/formatter.mjs` · `@axis-network/butter-col/formatter` | URL codecs and the HTML / CSS / JS rewriters |
| `dist/transports/butter.js` | The built-in transport |
| `site/` | The frontend |
| `server/` | nginx templates, Lua modules, default `config.lua` |
| `@axis-network/butter-col` | Node API: `distPath`, `sitePath`, `createPublicConfig`, `renderServerConfig`, `resolveTransport`, … |
| `butter-col` (bin) | CLI |

## CLI

```
butter-col server start|stop|reload|test [--port 8080] [--site dir] [--config butter.config.lua]
butter-col transport add <package-or-folder>    # e.g. @axis-network/bare-transport
butter-col transport list
butter-col static <outdir> [--config butter.static.json]   # serverless deployment
butter-col fetch-ca
butter-col paths
```

## Configuration

Copy `server/config.lua` to `butter.config.lua` in your project:

```lua
return {
  codec = "plain",                      -- none | plain | xor | base64
  transports = {
    { name = "butter" },
    { name = "bare", options = { server = "https://bare.example.com/" } },
  },
  default_transport = "butter",
  guard = { allow_private = false },    -- keep false on shared servers
}
```

## In your own page

```js
import { ButterController } from "/butter/controller.mjs";

const butter = await new ButterController().init();
await butter.setTransport("bare");
butter.go("example.com");
```

## Documentation

The full documentation (guide, packages, transports, building a transport, architecture, protocol, known issues) lives in the repository's `docs/` folder: <https://github.com/TheAxis-Network/butter-col>.

Read the known issues before exposing an instance to others. Like every same-origin proxy, all sites share one origin, and CORS/SameSite aren't emulated yet.

Inspired by Mercury Workshop's Scramjet and Titanium Network's Ultraviolet. Independent, and not affiliated with either.

MIT © Axis Network
