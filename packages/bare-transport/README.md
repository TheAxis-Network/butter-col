# @axis-network/bare-transport

A [butter-col](https://github.com/TheAxis-Network/butter-col) transport for [TompHTTP Bare](https://github.com/tomphttp/specifications) servers (protocol **v3**), the server type behind many Ultraviolet deployments.

```sh
npm install @axis-network/bare-transport
npx butter-col transport add @axis-network/bare-transport
```

```lua
-- butter.config.lua
transports = {
  { name = "butter" },
  { name = "bare", options = { server = "https://bare.example.com/" } },
},
```

| Option | Required | |
| --- | --- | --- |
| `server` | yes | The Bare server's root, absolute or relative to the proxy origin (`"/bare/"`). Requests go to `<server>v3/`. |

## Behaviour

- **HTTP:** `X-Bare-URL` and `X-Bare-Headers`. Values over 3072 bytes are split into `X-Bare-Headers-N` (and joined on the way back), per the spec.
- **WebSockets:** the v3 handshake (`connect` text frame → `open` message). `setCookies` from the handshake are stored in butter-col's jar.
- **Cookies:** `meta.cookies = "client"`. Bare servers keep no cookies, so butter-col's service worker does.
- **Errors:** `HOST_NOT_FOUND` → `DNS_FAILURE`; `CONNECTION_REFUSED` / `CONNECTION_RESET` → `UPSTREAM_UNREACHABLE`; `CONNECTION_TIMEOUT` → `UPSTREAM_TIMEOUT`; anything else → `BARE_<code>`.

## Notes

- It's tested against a mocked v3 server and has not yet been run against a real one. Please report incompatibilities.
- The Bare server decides what it may connect to. butter-col's own SSRF guard only applies to its built-in transport.
- The server must allow cross-origin requests and expose the `X-Bare-*` response headers.

## Programmatic use

```js
import { createBareTransport } from "@axis-network/bare-transport"; // no side effects
// dist/bare-transport.js (export "./browser") is the script that registers "bare".
```

Implemented from the public TompHTTP specification. Not affiliated with TompHTTP or Titanium Network.

MIT © Axis Network
