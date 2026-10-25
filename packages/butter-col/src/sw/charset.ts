/**
 * Decoding of text bodies. Response.text() always assumes UTF-8, which
 * garbles pages served as Shift_JIS, windows-1252 and so on, so the charset
 * is taken from the BOM, the Content-Type header, or (for HTML) a <meta>
 * prescan, like the browser would.
 */

function charsetFromContentType(contentType: string): string | null {
  const match = contentType.match(/;\s*charset\s*=\s*"?([^";\s]+)/i);
  return match ? match[1] : null;
}

function prescanHtml(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const meta =
    head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i) ||
    head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w.:-]+)/i);
  return meta ? meta[1] : null;
}

function bomCharset(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  return null;
}

export function decodeText(buffer: ArrayBuffer, contentType: string, isHtml: boolean): string {
  const bytes = new Uint8Array(buffer);
  const label = bomCharset(bytes) || charsetFromContentType(contentType) || (isHtml ? prescanHtml(bytes) : null) || "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return decoder.decode(bytes);
}

/** Replace (or add) the charset parameter; rewritten bodies are always UTF-8. */
export function withUtf8(contentType: string, fallback: string): string {
  const mime = contentType.split(";")[0].trim() || fallback;
  return `${mime}; charset=utf-8`;
}
