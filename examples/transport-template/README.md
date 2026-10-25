# butter-transport-template

A working butter-col transport to copy when you write your own. It registers **`logged`**, which wraps another transport and logs every request and WebSocket:

```
[logged → butter @ serviceworker] GET https://example.com/ → 200 28 ms
```

## Use it

```sh
npm run build                                         # dist/logged-transport.js
npx butter-col transport add ./examples/transport-template
```

```lua
transports = {
  { name = "butter" },
  { name = "logged", options = { inner = "butter" } },
},
```

| Option | Default | |
| --- | --- | --- |
| `inner` | the deployment's default transport, or `"butter"` | Transport to wrap |
| `innerOptions` | the inner transport's configured options | Options for it |

## Make it yours

1. Copy this folder and rename it in `package.json` (`name`, `butter.transport.name`, `butter.transport.browser`) and in `registerTransport()`.
2. Replace `src/index.js`. Keep the factory cheap; do the real work in `request()` and `connect()`.
3. Use `env.fetch` / `env.WebSocket`, never the globals.
4. `npm run build`, `npx butter-col transport add <folder>`, add it to `butter.config.lua`, reload.

The full guide, "Build a transport", is in the repository's `docs/custom-transports.html`.
