// Tests for the Bare v3 transport against a mocked Bare server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransport, registerTransport, TransportError } from "@axis-network/butter-transport";
import { createBareTransport, getBareHeaders, MAX_HEADER_VALUE, setBareHeaders } from "../dist/index.js";

const config = { version: "test", transport: {}, transports: [], defaultTransport: "bare" };

function env(fetchImpl, WebSocketImpl) {
  return { scope: "serviceworker", origin: "https://proxy.test", config, fetch: fetchImpl, WebSocket: WebSocketImpl };
}

const request = (overrides = {}) => ({
  url: new URL("https://example.com/a?b=1"),
  method: "GET",
  headers: { accept: "text/html" },
  body: null,
  context: { destination: "document", mode: "navigate", wantDocumentCookies: false },
  ...overrides,
});

test("validates through the transport registry", async () => {
  registerTransport("bare", createBareTransport);
  const transport = await createTransport("bare", { server: "https://bare.test/" }, env(fetch));
  assert.equal(transport.meta.name, "bare");
  assert.equal(transport.meta.cookies, "client");
  await assert.rejects(createTransport("bare", {}, env(fetch)), /options\.server is required/);
});

test("sends a Bare v3 request and parses the response", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    const headers = new Headers({ "x-bare-status": "302", "x-bare-status-text": "Found" });
    // Exercise split response headers.
    const json = JSON.stringify({ Location: "/next", "Set-Cookie": ["a=1", "b=2"], "Content-Type": "text/html" });
    headers.set("x-bare-headers-0", ";" + json.slice(0, 20));
    headers.set("x-bare-headers-1", ";" + json.slice(20));
    return new Response("hi", { status: 200, headers });
  };
  const transport = createBareTransport({ server: "/bare" }, env(fetchImpl));
  const res = await transport.request(request());

  assert.equal(seen.url, "https://proxy.test/bare/v3/");
  assert.equal(seen.init.headers.get("x-bare-url"), "https://example.com/a?b=1");
  const sent = JSON.parse(seen.init.headers.get("x-bare-headers"));
  assert.equal(sent.accept, "text/html");
  assert.ok(sent["user-agent"], "user-agent is supplied");
  assert.equal(seen.init.redirect, "manual");

  assert.equal(res.status, 302);
  assert.equal(res.statusText, "Found");
  assert.deepEqual(res.headers, [
    ["location", "/next"],
    ["set-cookie", "a=1"],
    ["set-cookie", "b=2"],
    ["content-type", "text/html"],
  ]);
  assert.equal(await new Response(res.body).text(), "hi");
});

test("splits long X-Bare-Headers and joins them back", () => {
  const headers = new Headers();
  const json = JSON.stringify({ "x-long": "y".repeat(MAX_HEADER_VALUE * 2) });
  setBareHeaders(headers, json);
  assert.equal(headers.has("x-bare-headers"), false);
  assert.ok(headers.get("x-bare-headers-0").startsWith(";"));
  assert.ok(headers.has("x-bare-headers-2"));
  assert.equal(getBareHeaders(headers), json);
});

test("maps Bare errors to transport errors", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ code: "HOST_NOT_FOUND", id: "request", message: "The DNS lookup for the host failed." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  const transport = createBareTransport({ server: "https://bare.test/" }, env(fetchImpl));
  await assert.rejects(transport.request(request()), (err) => {
    assert.ok(TransportError.is(err));
    assert.equal(err.code, "DNS_FAILURE");
    assert.equal(err.status, 500);
    return true;
  });
});

test("reports an unreachable server", async () => {
  const transport = createBareTransport({ server: "https://bare.test/" }, env(async () => {
    throw new TypeError("Failed to fetch");
  }));
  await assert.rejects(transport.request(request()), (err) => err.code === "TRANSPORT_UNREACHABLE");
});

test("performs the WebSocket handshake", () => {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }
    send(data) {
      this.sent.push(data);
    }
    close() {}
  }
  const transport = createBareTransport({ server: "https://bare.test/" }, env(fetch, FakeWebSocket));
  const events = [];
  transport.connect(new URL("wss://chat.example/socket"), ["v1"], { origin: "https://example.com" }, {
    open: (protocol) => events.push(["open", protocol]),
    message: (data) => events.push(["message", data]),
    close: (code) => events.push(["close", code]),
    error: (message) => events.push(["error", message]),
    cookies: (values) => events.push(["cookies", values]),
  });

  const ws = sockets[0];
  assert.equal(ws.url, "wss://bare.test/v3/");
  ws.onopen();
  const hello = JSON.parse(ws.sent[0]);
  assert.equal(hello.type, "connect");
  assert.equal(hello.remote, "wss://chat.example/socket");
  assert.deepEqual(hello.protocols, ["v1"]);
  assert.equal(hello.headers.origin, "https://example.com");

  ws.onmessage({ data: JSON.stringify({ type: "open", protocol: "v1", setCookies: ["s=1"] }) });
  ws.onmessage({ data: "hello" });
  ws.onclose({ code: 1000, reason: "", wasClean: true });
  assert.deepEqual(events, [["cookies", ["s=1"]], ["open", "v1"], ["message", "hello"], ["close", 1000]]);
});
