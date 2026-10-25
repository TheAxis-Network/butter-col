/**
 * butter-col in-page runtime. Loaded at the top of every proxied document
 * (injected by the service worker) and every proxied worker (prepended).
 *
 * Expects self.__butter$config (and, in documents, self.__butter$boot) to be
 * defined before it runs.
 */
import { createFormatter } from "../formatter/index.js";
import { createCore } from "./core.js";
import { install } from "./install.js";

(() => {
  const scope = /** @type {any} */ (globalThis);
  if (Object.prototype.hasOwnProperty.call(scope, "__butter$runtime")) return;

  const config = scope.__butter$config;
  if (!config) {
    console.error("[butter] __butter$config is missing; the runtime was not installed.");
    return;
  }
  const boot = scope.__butter$boot || {};
  delete scope.__butter$config;
  delete scope.__butter$boot;
  const formatter = createFormatter({ origin: scope.location.origin, prefix: config.prefix, codec: config.codec });

  // Transports and the runtime itself need the real APIs, captured before
  // the hooks replace them.
  const container = scope.navigator && scope.navigator.serviceWorker;
  const ContainerProto = scope.ServiceWorkerContainer && scope.ServiceWorkerContainer.prototype;
  const controllerGetter = ContainerProto && Object.getOwnPropertyDescriptor(ContainerProto, "controller")?.get;
  const natives = {
    fetch: scope.fetch.bind(scope),
    WebSocket: scope.WebSocket,
    controller: () => (container && controllerGetter ? controllerGetter.call(container) : null),
  };

  const core = createCore(config, formatter, boot, natives);
  install(core, scope);

  // Leave the page's DOM as the site authored it.
  if (scope.document) {
    for (const el of scope.document.querySelectorAll("script[data-butter]")) el.remove();
  }
})();
