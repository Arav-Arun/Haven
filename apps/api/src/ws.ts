// Add-on F4: WebSocket pass-through for doorbell subscriptions. A browser can't reach our Bee node (it stays private,
// see app.ts), so GET /doorbell/subscribe/<chunk address> is upgraded and piped to Bee's /gsoc/subscribe/<address>.
// Only that one path, only 64-hex addresses, and a cap on open connections. Nothing is logged or inspected: the
// payloads are sealed for the folder's current members.

import type { IncomingMessage, Server } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";

const PATH = /^\/doorbell\/subscribe\/([0-9a-f]{64})$/i;

export function attachDoorbellProxy(server: Pick<Server, "on">, beeUrl: string, maxConnections = 1000): { open(): number } {
  let open = 0;
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = PATH.exec(req.url ?? "");
    if (!m || open >= maxConnections) {
      socket.end(`HTTP/1.1 ${m ? "503 Service Unavailable" : "404 Not Found"}\r\nconnection: close\r\n\r\n`);
      return;
    }
    const target = new URL(`${beeUrl.replace(/\/+$/, "")}/gsoc/subscribe/${m[1]!.toLowerCase()}`);
    const forward: Record<string, string> = { host: target.host, connection: "Upgrade", upgrade: "websocket" };
    for (const h of ["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]) {
      const v = req.headers[h];
      if (typeof v === "string") forward[h] = v;
    }
    const upstream = (target.protocol === "https:" ? httpsRequest : httpRequest)({
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: target.pathname,
      method: "GET",
      headers: forward,
    });
    upstream.on("upgrade", (res, bee, beeHead) => {
      open++;
      const lines = [`HTTP/1.1 101 Switching Protocols`];
      for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") lines.push(`${k}: ${v}`);
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (beeHead.length) socket.write(beeHead);
      if (head.length) bee.write(head);
      const done = () => {
        open = Math.max(0, open - 1);
        bee.destroy();
        socket.destroy();
      };
      bee.once("close", done);
      socket.once("close", done);
      bee.on("error", done);
      socket.on("error", done);
      bee.pipe(socket);
      socket.pipe(bee);
    });
    upstream.on("response", (res) => {
      socket.end(`HTTP/1.1 ${res.statusCode ?? 502} Bad Gateway\r\nconnection: close\r\n\r\n`);
      res.resume();
    });
    upstream.on("error", () => socket.end("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n"));
    upstream.end();
  });
  return { open: () => open };
}
