# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately rather than in a public issue. Use GitHub's private vulnerability reporting on [TheAxis-Network/butter-col](https://github.com/TheAxis-Network/butter-col/security), or contact the Axis Network maintainers directly.

Include what an attacker can do, how to reproduce it, and which package and version are affected. We'll confirm receipt, agree on a fix and a disclosure date with you, and credit you unless you'd rather not be named.

## What counts

Report it privately if it's any of these:

- Reaching private networks, cloud metadata or the server itself through the `butter` transport (bypassing the SSRF guard).
- Header injection or request smuggling through `/butter/fetch` or `/butter/ws`.
- A proxied page reading cookies, cookie jars or storage it shouldn't, beyond the documented limitations.
- A proxied page changing another visitor's or its own visitor's transport.
- Code execution or file access on the server.

## Known limitations

Some weaknesses are inherent to same-origin interception proxies or not fixed yet, and are documented openly in `docs/known-issues.html`. The most important:

- **No CORS or SameSite emulation:** a malicious proxied page can read responses from other sites the visitor uses through the same proxy.
- **One shared origin:** every proxied site shares the proxy's origin, and with it IndexedDB, Cache API and BroadcastChannel.
- **Removed protections:** CSP, SRI and iframe sandboxing are stripped from proxied pages.
- **Plaintext on the server:** the `butter` transport's server sees all proxied traffic.

Improvements to these are very welcome as regular pull requests.
