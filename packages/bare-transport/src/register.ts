/**
 * Browser entry (dist/bare-transport.js): registers the "bare" transport.
 * butter-col loads this script in the service worker, pages and workers.
 */
import { registerTransport } from "@axis-network/butter-transport";
import { createBareTransport, type BareTransportOptions } from "./index.js";

registerTransport<BareTransportOptions>("bare", createBareTransport);
