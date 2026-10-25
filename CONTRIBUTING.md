# Contributing to butter-col

Thanks for helping. This file covers how the repository is laid out, how to run it, and what a good change looks like.

## Setup

```sh
npm install                 # links the workspaces
npm run build               # builds every package
npx butter-col transport add @axis-network/bare-transport
npx butter-col transport add butter-transport-template
npm start                   # docs at http://localhost:8080/, frontend at /app/
```

OpenResty 1.21+ is needed for `npm start`. On Windows, unzip `openresty-<version>-win64.zip` into `.tools/`.

## Where things live

| Path | Language | What |
| --- | --- | --- |
| `packages/butter-col/server/` | Lua | The OpenResty server behind the `butter` transport |
| `packages/butter-col/src/sw/` | TypeScript | The service worker |
| `packages/butter-col/src/formatter/` | JavaScript | URL codecs and the HTML / CSS / JS rewriters |
| `packages/butter-col/src/client/` | JavaScript | The in-page runtime |
| `packages/butter-col/site/` | HTML / CSS / JS | The built-in frontend |
| `packages/butter-transport/` | TypeScript | The transport API |
| `packages/bare-transport/` | TypeScript | The Bare transport |
| `docs/` | HTML / CSS | The documentation site |

## Before you open a pull request

```sh
npm run check               # build, typecheck, JS tests, Lua tests
```

- **Rewriter bugs:** add the smallest failing snippet to `packages/butter-col/test/formatter.test.mjs`.
- **Cookie behaviour:** change `cookiejar.lua` and `src/sw/cookie-jar.ts` together, and keep their tests in step.
- **Pure Lua modules** (`url`, `ip`, `cookiejar`, `headers`, `config`) must not use `ngx` or Lua 5.2+ features, because their tests run in fengari.
- **Docs:** update `docs/` when behaviour changes, and add new limitations to `docs/known-issues.html` instead of hiding them.
- **Commits:** keep them focused; one change per pull request is easiest to review.

## New transports

Start from `examples/transport-template` and read `docs/custom-transports.html`. Community transports belong in their own repositories and packages. Official Axis Network transports are published under `@axis-network`.

## Security issues

Please don't open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
