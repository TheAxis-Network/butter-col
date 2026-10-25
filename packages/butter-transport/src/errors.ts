/**
 * Error codes butter-col understands. Transports may use their own codes too
 * (prefix them, e.g. "BARE_..."); they are shown to the visitor as-is.
 */
export const TRANSPORT_ERROR_CODES = {
  /** The transport's backend could not be reached. */
  UNREACHABLE: "TRANSPORT_UNREACHABLE",
  /** The backend answered with something the transport could not understand. */
  BAD_RESPONSE: "BAD_TRANSPORT_RESPONSE",
  /** The target's host name did not resolve. */
  DNS_FAILURE: "DNS_FAILURE",
  /** The target refused or reset the connection, or TLS failed. */
  UPSTREAM_UNREACHABLE: "UPSTREAM_UNREACHABLE",
  /** The target did not answer in time. */
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  /** The backend refused this target (policy). */
  BLOCKED: "BLOCKED",
  /** Anything else. */
  ERROR: "TRANSPORT_ERROR",
} as const;

/**
 * Throw this from request() to give the visitor a meaningful error page.
 * `status` is the HTTP status of that page (502 by default).
 */
export class TransportError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "TransportError";
    this.code = code;
    this.status = status;
  }

  /** Errors cross realms (service worker → page); recognise them by shape too. */
  static is(value: unknown): value is TransportError {
    return value instanceof TransportError ||
      (!!value && typeof value === "object" && (value as Error).name === "TransportError" &&
        typeof (value as TransportError).code === "string");
  }
}
