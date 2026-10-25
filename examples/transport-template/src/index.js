/**
 * Template transport for butter-col: "logged".
 *
 * Copy this folder to start your own transport. This one wraps another
 * transport (the inner one does the real work) and logs every request and
 * WebSocket to the console, which is handy for debugging a deployment.
 *
 * Configure it in butter.config.lua:
 *   { name = "logged", options = { inner = "butter" } }
 *
 * The file is bundled (esbuild, see build.mjs) into a classic script that
 * butter-col loads in the service worker, in proxied pages and in workers.
 */
import { createTransport, registerTransport } from "@axis-network/butter-transport";

/**
 * @typedef {object} LoggedOptions
 * @property {string} [inner]          transport to wrap (default: the deployment's default, or "butter")
 * @property {unknown} [innerOptions]  options for it (default: its configured options)
 */

/** @type {import("@axis-network/butter-transport").TransportFactory<LoggedOptions>} */
async function createLoggedTransport(options, env) {
  const configuredDefault = env.config.defaultTransport;
  const innerName = (options && options.inner) || (configuredDefault !== "logged" ? configuredDefault : "butter");
  if (innerName === "logged") throw new Error('logged-transport: "inner" cannot be "logged" itself');

  const innerEntry = env.config.transports.find((t) => t.name === innerName);
  const innerOptions = options && options.innerOptions !== undefined ? options.innerOptions : innerEntry && innerEntry.options;
  // The inner transport's script is loaded too: butter-col loads every
  // configured transport in each realm, so they can wrap each other.
  const inner = await createTransport(innerName, innerOptions, env);
  const tag = `[logged → ${innerName} @ ${env.scope}]`;

  /** @type {import("@axis-network/butter-transport").ButterTransport} */
  const transport = {
    meta: {
      ...inner.meta,
      name: "logged",
      description: `Logs every request, then hands it to "${innerName}".`,
    },

    async request(req) {
      const started = performance.now();
      try {
        const res = await inner.request(req);
        console.info(tag, req.method, req.url.href, "→", res.status, `${Math.round(performance.now() - started)} ms`);
        return res;
      } catch (err) {
        console.warn(tag, req.method, req.url.href, "failed:", err && err.message);
        throw err;
      }
    },

    destroy() {
      if (inner.destroy) inner.destroy();
    },
  };

  if (inner.connect) {
    transport.connect = (url, protocols, headers, handlers) => {
      console.info(tag, "WebSocket", url.href, protocols);
      return inner.connect(url, protocols, headers, {
        ...handlers,
        close(code, reason, wasClean) {
          console.info(tag, "WebSocket closed", url.href, code, reason);
          handlers.close(code, reason, wasClean);
        },
      });
    };
  }

  return transport;
}

registerTransport("logged", createLoggedTransport);
