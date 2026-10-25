# @axis-network/butter-transport

The transport API for [butter-col](https://github.com/TheAxis-Network/butter-col): types, the transport registry, `TransportError`, and a smoke-testing kit. It's the only dependency a transport needs.

```sh
npm install @axis-network/butter-transport
```

## A transport in one screen

```js
import { registerTransport, TransportError } from "@axis-network/butter-transport";

registerTransport("tiny", (options, env) => ({
  meta: { name: "tiny", cookies: "client", websockets: false },

  async request(req) {
    // req: { url, method, headers, body, signal, context }
    let res;
    try {
      res = await env.fetch(new URL(options.endpoint, env.origin), {
        method: "POST",
        body: JSON.stringify({ url: req.url.href, method: req.method, headers: req.headers }),
        signal: req.signal,
      });
    } catch {
      throw new TransportError("TRANSPORT_UNREACHABLE", "The tiny server is down.");
    }
    const meta = JSON.parse(res.headers.get("x-tiny-meta"));
    return { status: meta.status, headers: meta.headers, body: res.body };
  },
}));
```

Bundle it as an IIFE (one classic script). butter-col loads it in the service worker, in proxied pages and in workers. Declare it in `package.json` so `butter-col transport add` can find it:

```json
"butter": { "transport": { "name": "tiny", "browser": "dist/tiny-transport.js" } }
```

## The rules that matter

- Use `env.fetch` and `env.WebSocket`, never the globals. In pages they are butter-col's hooks, and the global `WebSocket` calls *your* `connect()`.
- `meta.cookies`: `"server"` if your backend keeps cookies (return `documentCookies` when `context.wantDocumentCookies`), otherwise `"client"` (butter-col adds `cookie` and reads every `set-cookie` pair).
- Don't follow redirects. Return `set-cookie` as separate pairs and bodies decoded.
- Throw `TransportError` with a standard code (`TRANSPORT_ERROR_CODES`), and re-throw `AbortError` unchanged.
- In `connect()`, call `handlers.close()` exactly once.

## API

`registerTransport(name, factory)` · `createTransport(name, options, env)` · `getTransportFactory(name)` · `listTransports()` · `validateTransport(obj)` · `TransportError` · `TRANSPORT_ERROR_CODES` · `headersToList()` · `listToObject()` · `readBody()`, plus the types `ButterTransport`, `TransportFactory`, `TransportEnvironment`, `TransportMeta`, `TransportRequest`, `TransportResponse`, `SocketHandlers`, `TransportSocket`, `ButterPublicConfig`.

```js
import { smokeTest } from "@axis-network/butter-transport/testing";
const report = await smokeTest(transport, { url: "https://example.com/", websocketUrl: "wss://echo.example/" });
```

The full guide, "Build a transport", is in the butter-col repository's `docs/custom-transports.html`.

MIT © Axis Network
