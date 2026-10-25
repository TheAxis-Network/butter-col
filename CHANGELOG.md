# Changelog

All notable changes to butter-col's packages. Versions follow [Semantic Versioning](https://semver.org/); before 1.0, minor versions may break things.

## 0.1.0 (unreleased)

First release of all packages.

### @axis-network/butter-col

- Service worker (TypeScript) that intercepts proxied pages, recomputes Referer / Origin / Sec-Fetch-* and runs the active transport.
- Formatter (JavaScript): URL codecs (`none`, `plain`, `xor`, `base64`) and HTML, CSS and JavaScript rewriters.
- Client runtime: `location`, DOM, network, cookie, storage, messaging and worker hooks; a WebSocket implementation on top of transports.
- OpenResty (Lua) server for the built-in `butter` transport: SSRF guard with DNS pinning, server-side cookie jars, rate limiting, WebSocket tunnel.
- Client-side (IndexedDB) cookie jar for transports without a server jar.
- Built-in frontend with an in-page browser, recent sites, themes and a transport picker; served at `/` and `/app/`.
- `ButterController` for launcher pages, including `setTransport()` and `resetTransport()`.
- `butter-col` CLI: `server start|stop|reload|test`, `transport add|list`, `static`, `fetch-ca`, `paths`.
- Node API: package paths, `createPublicConfig`, `createConfigScript`, `renderServerConfig`, `resolveTransport`, `findOpenResty`.

### @axis-network/butter-transport

- Transport types, registry (`registerTransport`, `createTransport`, `validateTransport`), `TransportError` and header helpers.
- `@axis-network/butter-transport/testing`: `smokeTest()`.

### @axis-network/bare-transport

- Client for TompHTTP Bare v3 servers: split `X-Bare-Headers`, the v3 WebSocket handshake, error-code mapping.
