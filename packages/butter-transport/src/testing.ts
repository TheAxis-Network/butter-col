/**
 * @axis-network/butter-transport/testing: quick checks for transport authors.
 *
 *   import { smokeTest } from "@axis-network/butter-transport/testing";
 *   const report = await smokeTest(transport, {
 *     url: "https://example.com/",
 *     websocketUrl: "wss://echo.example/",
 *   });
 *   console.table(report.checks);
 */
import { validateTransport } from "./index.js";
import type { ButterTransport, HeaderList } from "./types.js";
import { readBody } from "./util.js";

export interface SmokeTestOptions {
  /** An http(s) URL that answers GET with a 2xx/3xx. */
  url: string;
  /** Optional ws(s) echo server: the test sends a message and expects it back. */
  websocketUrl?: string;
  /** Per-step timeout in milliseconds (default 15000). */
  timeout?: number;
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SmokeReport {
  ok: boolean;
  checks: SmokeCheck[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isHeaderList(value: unknown): value is HeaderList {
  return Array.isArray(value) && value.every((pair) => Array.isArray(pair) && pair.length === 2 &&
    typeof pair[0] === "string" && typeof pair[1] === "string");
}

export async function smokeTest(transport: ButterTransport, options: SmokeTestOptions): Promise<SmokeReport> {
  const timeout = options.timeout ?? 15000;
  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  const problems = validateTransport(transport);
  check("shape", problems.length === 0, problems.join("; ") || "meta, request() and connect() look right");
  if (problems.length) return { ok: false, checks };

  try {
    const res = await withTimeout(
      transport.request({
        url: new URL(options.url),
        method: "GET",
        headers: { accept: "*/*" },
        body: null,
        context: { destination: "", mode: "cors", wantDocumentCookies: false },
      }),
      timeout,
      "request()",
    );
    check("status", Number.isInteger(res.status) && res.status >= 200 && res.status <= 599, `status ${res.status}`);
    check("headers", isHeaderList(res.headers), isHeaderList(res.headers) ? `${res.headers.length} headers` : "not a [name, value][] list");
    const body = await withTimeout(readBody(res.body), timeout, "reading the body");
    check("body", body.byteLength >= 0, `${body.byteLength} bytes`);
  } catch (err) {
    check("request", false, String((err as Error)?.message ?? err));
  }

  if (options.websocketUrl) {
    if (!transport.meta.websockets || !transport.connect) {
      check("websocket", false, "meta.websockets is false");
    } else {
      try {
        const echoed = await withTimeout(
          new Promise<string>((resolve, reject) => {
            const socket = transport.connect!(new URL(options.websocketUrl!), [], {}, {
              open: () => socket.send("butter-smoke-test"),
              message: (data) => {
                if (typeof data === "string" && data.includes("butter-smoke-test")) {
                  socket.close(1000, "done");
                  resolve(data);
                }
              },
              close: (code, reason) => reject(new Error(`closed early (${code} ${reason})`)),
              error: (message) => reject(new Error(message)),
            });
          }),
          timeout,
          "websocket echo",
        );
        check("websocket", true, `echoed ${JSON.stringify(echoed)}`);
      } catch (err) {
        check("websocket", false, String((err as Error)?.message ?? err));
      }
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
