import { TransportError } from "@axis-network/butter-transport";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function describeError(err: unknown): { code: string; message: string; status: number } {
  // Transports bundle their own copy of TransportError, so match by shape.
  if (TransportError.is(err)) return { code: err.code, message: err.message, status: err.status || 502 };
  if (err instanceof Error) return { code: "INTERNAL_ERROR", message: err.message, status: 500 };
  return { code: "INTERNAL_ERROR", message: String(err), status: 500 };
}

export function errorResponse(request: Request, target: URL | null, err: unknown): Response {
  const { code, message, status } = describeError(err);
  const headers = { "X-Butter-Error-Code": code, "Cache-Control": "no-store" };

  if (request.mode !== "navigate" && request.destination !== "iframe" && request.destination !== "frame") {
    return new Response(`butter-col: ${code}: ${message}`, {
      status,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const where = target ? escapeHtml(target.href) : "the requested page";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>butter-col · ${escapeHtml(code)}</title>
<style>
  :root { color-scheme: light dark; --bg: #fbf8f1; --fg: #2a2418; --muted: #75694f; --accent: #e3a92b; --card: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17140e; --fg: #f1eadb; --muted: #a99c80; --card: #221e16; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg);
         font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 34rem; margin: 1.5rem; padding: 2rem; background: var(--card); border-radius: 14px;
         border-top: 5px solid var(--accent); box-shadow: 0 10px 30px rgb(0 0 0 / .08); }
  h1 { margin: 0 0 .5rem; font-size: 1.35rem; }
  code { font: .85em ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
  .code { color: var(--muted); font-size: .85rem; letter-spacing: .04em; }
  button { margin-top: 1rem; font: inherit; padding: .5rem 1rem; border-radius: 8px; border: 0; background: var(--accent); color: #2a2418; cursor: pointer; }
</style>
</head>
<body>
<main>
  <div class="code">${escapeHtml(code)}</div>
  <h1>butter-col couldn't load this page</h1>
  <p>${escapeHtml(message)}</p>
  <p><code>${where}</code></p>
  <button onclick="location.reload()">Try again</button>
</main>
</body>
</html>`;
  return new Response(html, { status, headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}
