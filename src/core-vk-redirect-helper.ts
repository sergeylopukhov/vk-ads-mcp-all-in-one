import { createServer, request } from "node:http";

import { VK_CORE_LOOPBACK_HOST, VK_CORE_LOOPBACK_PORT } from "./core-vk.js";

const MAX_CALLBACK_URL_LENGTH = 8_192;

const forwardCallback = (incoming: import("node:http").IncomingMessage, outgoing: import("node:http").ServerResponse) => {
  if (incoming.method !== "GET" || !incoming.url || incoming.url.length > MAX_CALLBACK_URL_LENGTH) {
    outgoing.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    outgoing.end("Invalid local OAuth callback.");
    return;
  }
  const callbackUrl = new URL(incoming.url, "http://localhost");
  if (callbackUrl.pathname !== "/") {
    outgoing.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    outgoing.end("Not found.");
    return;
  }
  const forwarded = request({
    host: VK_CORE_LOOPBACK_HOST,
    port: VK_CORE_LOOPBACK_PORT,
    path: `${callbackUrl.pathname}${callbackUrl.search}`,
    method: "GET",
    headers: { Host: "localhost", Connection: "close" },
    timeout: 15_000,
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, {
      "Content-Type": response.headers["content-type"] ?? "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    });
    response.pipe(outgoing);
  });
  forwarded.on("timeout", () => forwarded.destroy(new Error("OAuth callback timed out.")));
  forwarded.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    outgoing.end("OAuth callback is not waiting. Return to Codex and start connection again.");
  });
  forwarded.end();
};

const ipv4Helper = createServer(forwardCallback);
const ipv6Helper = createServer(forwardCallback);

ipv4Helper.listen(80, VK_CORE_LOOPBACK_HOST, () => {
  process.stderr.write("VK Core OAuth redirect helper listens only on localhost:80. Keep this terminal open while connecting VK.\n");
});
ipv6Helper.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRNOTAVAIL") return;
  process.stderr.write("VK Core OAuth IPv6 helper could not start. IPv4 localhost remains available.\n");
});
ipv6Helper.listen(80, "::1");
