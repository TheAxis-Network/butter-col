// Downloads Mozilla's CA bundle (as published by the curl project) to
// server/conf/cacert.pem, which nginx uses to verify upstream TLS certificates.
import { writeFile } from "node:fs/promises";

const SOURCE = "https://curl.se/ca/cacert.pem";
const target = new URL("../server/conf/cacert.pem", import.meta.url);

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`GET ${SOURCE} failed: HTTP ${res.status}`);
const pem = await res.text();
const count = (pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
if (count < 50) throw new Error(`Unexpected bundle contents (${count} certificates)`);
await writeFile(target, pem);
console.log(`wrote ${count} certificates to server/conf/cacert.pem`);
