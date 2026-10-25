import type { HeaderList } from "./types.js";

/** Headers / object / list → HeaderList (names lower-cased). */
export function headersToList(headers: Headers | Record<string, string | string[]> | HeaderList): HeaderList {
  const list: HeaderList = [];
  if (Array.isArray(headers)) {
    for (const [name, value] of headers) list.push([name.toLowerCase(), value]);
  } else if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, name) => list.push([name, value]));
    // Headers joins Set-Cookie values; getSetCookie() keeps them apart.
    const setCookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    if (setCookies.length) {
      const rest = list.filter(([name]) => name !== "set-cookie");
      return [...rest, ...setCookies.map((value): [string, string] => ["set-cookie", value])];
    }
  } else {
    for (const [name, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) list.push([name.toLowerCase(), String(v)]);
    }
  }
  return list;
}

/** HeaderList → object, joining repeated names with ", " (Set-Cookie kept as array). */
export function listToObject(list: HeaderList): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of list) {
    const key = name.toLowerCase();
    if (key === "set-cookie") {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, value] : [value];
    } else {
      out[key] = key in out ? `${out[key]}, ${value}` : value;
    }
  }
  return out;
}

/** Read any TransportResponse body into an ArrayBuffer. */
export async function readBody(body: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null): Promise<ArrayBuffer> {
  if (body == null) return new ArrayBuffer(0);
  if (body instanceof ArrayBuffer) return body;
  return new Response(body as BodyInit).arrayBuffer();
}
