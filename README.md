<p align="center">
  <img src="butter-col.png" alt="butter-col" width="420">
</p>

<p align="center"><strong>A service-worker web proxy with pluggable transports, a built-in frontend and an OpenResty (Lua) backend.</strong><br>
Made by <a href="https://github.com/TheAxis-Network">Axis Network</a>.</p>

---

butter-col works like [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) and [Scramjet](https://github.com/MercuryWorkshop/scramjet). A service worker intercepts everything a proxied page does, hands each request to a **transport**, and rewrites what comes back so the site keeps working from the proxy's origin.

- **Frontend included.** A search-or-address box and an in-page browser with an address bar, back, forward and reload, plus recent sites, themes and a transport picker.
- **Pluggable transports.** Swap how traffic leaves the browser, the way bare-mux does for Scramjet: butter-col's own server, a Bare server, or one you write.
- **A careful server.** The built-in transport's OpenResty server pins DNS against private networks, keeps HttpOnly cookies server-side, verifies upstream TLS and streams through nginx.
- **Serverless option.** With a transport like `bare`, `butter-col static` produces plain files for any static host.

## Quick start

```sh
npm install @axis-network/butter-col
npx butter-col server start          # frontend on http://localhost:8080/
```

You need **Node.js 20+** and, for the built-in transport, **OpenResty 1.21+**. On Windows, unzip the official `openresty-<version>-win64.zip` into `.tools/` and the CLI finds it. Elsewhere, install the `openresty` package or pass `--openresty`. Service workers only run over `https://` or on `localhost`.

## Packages

| Package | |
| --- | --- |
| [`@axis-network/butter-col`](packages/butter-col) | The proxy: service worker (TypeScript), formatter and runtime (JavaScript), Lua server, frontend, `ButterController`, `butter-col` CLI |
| [`@axis-network/butter-transport`](packages/butter-transport) | The transport API: types, registry, `TransportError`, testing kit |
| [`@axis-network/bare-transport`](packages/bare-transport) | Transport for TompHTTP Bare v3 servers |

## Transports

| Transport | Where from | Backend |
| --- | --- | --- |
| `butter` (default) | built into `@axis-network/butter-col` | butter-col's OpenResty server |
| `bare` | `@axis-network/bare-transport` | any Bare v3 server |
| `logged` | `examples/transport-template` | wraps another transport and logs every request; the template for your own |
| `svrls`, `hubber`, `feeral` | Axis Network | official transports; documentation pending |

```sh
npm install @axis-network/bare-transport
npx butter-col transport add @axis-network/bare-transport
```

```lua
-- butter.config.lua
return {
  transports = {
    { name = "butter" },
    { name = "bare", options = { server = "https://bare.example.com/" } },
  },
  default_transport = "butter",
}
```

## Working on this repository

```sh
npm install                                    # links the workspaces
npm run build                                  # all packages
npx butter-col transport add @axis-network/bare-transport
npx butter-col transport add butter-transport-template
npm start                                      # docs on :8080, frontend on :8080/app/
npm run check                                  # build, typecheck, JS + Lua tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout and conventions, and [CHANGELOG.md](CHANGELOG.md) for what's in each release.

## Documentation

`npm start` serves the docs at <http://localhost:8080/>; their sources are in [`docs/`](docs).

- **[Guide](docs/guide.html):** install, run, the frontend, configuration, deployment, troubleshooting
- **[Packages](docs/packages.html):** the npm modules, CLI, Node API, `ButterController`, serverless deployments
- **[Transports](docs/transports.html):** the catalogue, configuring and switching them
- **[Build a transport](docs/custom-transports.html):** writing, testing, packaging and publishing your own
- **[Architecture](docs/architecture.html)**, **[Formatter](docs/formatter.html)**, **[Protocol](docs/protocol.html)**
- **[Known issues](docs/known-issues.html):** limitations and likely bugs, by severity
- **[Credits](docs/credits.html)**

## Status and caveats

butter-col is early and unaudited. The formatter, both cookie jars, the Lua modules and the Bare transport have unit tests. The `butter` and `logged` transports have been exercised end to end, over HTTP and WebSockets, against a live server. The full in-browser experience on real sites has **not** been broadly tested yet.

Like every same-origin interception proxy, it puts every site on one origin, and it does **not yet emulate CORS or SameSite**. A malicious page opened through it can read responses from other sites you're logged into through the same proxy. Read [Known issues](docs/known-issues.html) and [SECURITY.md](SECURITY.md) before you let anyone else use your instance.

## Credits

The idea for butter-col comes from the work of **[Mercury Workshop](https://github.com/MercuryWorkshop)** (Scramjet, Wisp, epoxy, libcurl.js, bare-mux) and **[Titanium Network](https://github.com/titaniumnetwork-dev)** (Ultraviolet, Bare). Thank you for proving that a whole website can live inside a service worker.

butter-col is independent: it isn't affiliated with or endorsed by either group, and it contains none of their code. `@axis-network/bare-transport` implements the public [TompHTTP Bare specification](https://github.com/tomphttp/specifications). See [Credits](docs/credits.html).

[MIT](LICENSE) © Axis Network
