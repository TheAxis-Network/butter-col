/**
 * ButterController: the page-side API of butter-col.
 *
 *   import { ButterController } from "/butter/controller.mjs";
 *   const butter = await new ButterController().init();
 *   await butter.setTransport("bare", { server: "https://bare.example/" });
 *   butter.go("example.com");
 *
 * It installs the service worker, reads /butter/config.js, encodes URLs with
 * the configured codec and talks to the service worker to list and switch
 * transports (the choice is remembered per browser).
 */
import type { ButterPublicConfig, TransportEntry } from "@axis-network/butter-transport";
import { createFormatter, type Formatter } from "../formatter/index.js";

export interface ButterControllerOptions {
  /** Service worker script (default "/butter/sw.js"). */
  serviceWorker?: string;
  /** Registration scope (default "/"); the server must allow it with Service-Worker-Allowed. */
  scope?: string;
  /** Configuration script (default "/butter/config.js"). */
  config?: string;
  /** Search URL used by go() for input that is not a URL; "%s" is the query. */
  searchEngine?: string;
}

export interface TransportStatus {
  active: { name: string; url: string; options: unknown };
  available: Array<{ name: string; url: string; loaded: boolean }>;
}

export class ButterController {
  readonly options: Required<ButterControllerOptions>;
  config: ButterPublicConfig | null = null;
  registration: ServiceWorkerRegistration | null = null;
  #formatter: Formatter | null = null;

  constructor(options: ButterControllerOptions = {}) {
    this.options = {
      serviceWorker: options.serviceWorker ?? "/butter/sw.js",
      scope: options.scope ?? "/",
      config: options.config ?? "/butter/config.js",
      searchEngine: options.searchEngine ?? "https://duckduckgo.com/?q=%s",
    };
  }

  /** Register the service worker (waiting until it is active) and load the configuration. */
  async init(): Promise<this> {
    if (!("serviceWorker" in navigator)) {
      throw new Error("This browser has no service workers (private windows often disable them).");
    }
    if (!window.isSecureContext) throw new Error("Service workers need HTTPS (or localhost).");
    const [config, registration] = await Promise.all([this.#loadConfig(), this.#register()]);
    this.config = config;
    this.registration = registration;
    this.#formatter = createFormatter({ origin: location.origin, prefix: config.prefix, codec: config.codec });
    return this;
  }

  /** Proxy URL for an absolute target URL. */
  encodeUrl(url: string | URL): string {
    return this.#f().rewriteUrl(String(url), location.href);
  }

  /** Target URL for a proxy URL (input returned unchanged if it is not one). */
  decodeUrl(url: string | URL): string {
    return this.#f().unrewriteUrl(String(url));
  }

  /** Turn what someone typed into a URL: full URL, bare domain, or a search. */
  resolveInput(input: string): string {
    const value = input.trim();
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[^\s]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(value)) return "https://" + value;
    return this.options.searchEngine.replace("%s", encodeURIComponent(value));
  }

  /** Navigate this tab to `input` through the proxy. */
  go(input: string): void {
    location.href = this.encodeUrl(this.resolveInput(input));
  }

  /** Transports this deployment offers (from the configuration). */
  get transports(): TransportEntry[] {
    return this.config?.transports ?? [];
  }

  /** Which transport is active for this browser, and which could be. */
  async getTransport(): Promise<TransportStatus> {
    return (await this.#ask({ type: "butter:get-transport" })) as TransportStatus;
  }

  /**
   * Switch transports for this browser. `options` replaces the configured
   * options for that transport; omit it to use the deployment's defaults.
   * Pages already open keep their WebSocket transport until reloaded.
   */
  async setTransport(name: string, options?: unknown): Promise<TransportStatus["active"]> {
    const reply = (await this.#ask({ type: "butter:set-transport", name, options })) as { active: TransportStatus["active"] };
    return reply.active;
  }

  /** Go back to the deployment's default transport. */
  async resetTransport(): Promise<TransportStatus["active"]> {
    const reply = (await this.#ask({ type: "butter:reset-transport" })) as { active: TransportStatus["active"] };
    return reply.active;
  }

  #f(): Formatter {
    if (!this.#formatter) throw new Error("ButterController: call init() first");
    return this.#formatter;
  }

  async #loadConfig(): Promise<ButterPublicConfig> {
    const res = await fetch(this.options.config, { credentials: "same-origin", cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load ${this.options.config} (HTTP ${res.status}).`);
    const match = (await res.text()).match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
    if (!match) throw new Error(`${this.options.config} is not a butter-col configuration.`);
    return JSON.parse(match[1]) as ButterPublicConfig;
  }

  async #register(): Promise<ServiceWorkerRegistration> {
    const registration = await navigator.serviceWorker.register(this.options.serviceWorker, { scope: this.options.scope });
    const worker = registration.installing || registration.waiting || registration.active;
    if (worker && worker.state !== "activated") {
      await new Promise<void>((resolve, reject) => {
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
          if (worker.state === "redundant") reject(new Error("The butter-col service worker failed to install."));
        });
      });
    }
    return registration;
  }

  async #ask(message: { type: string; [key: string]: unknown }): Promise<unknown> {
    const worker = this.registration?.active;
    if (!worker) throw new Error("ButterController: call init() first");
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => reject(new Error("The service worker did not answer.")), 10000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        if (event.data?.ok) resolve(event.data.result);
        else reject(new Error(event.data?.error || "The service worker refused the request."));
      };
      worker.postMessage(message, [channel.port2]);
    });
  }
}

export default ButterController;
