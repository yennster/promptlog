import { createServer, type Socket } from "node:net";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import {
  DAEMON_SOCKET_PATH,
  type DaemonRequest,
  type DaemonResponse,
} from "@promptlog/shared";

export type Handler = (req: DaemonRequest) => Promise<DaemonResponse>;

export function startSocketServer(handler: Handler) {
  mkdirSync(dirname(DAEMON_SOCKET_PATH), { recursive: true });
  try {
    unlinkSync(DAEMON_SOCKET_PATH);
  } catch {
    /* file may not exist */
  }
  const server = createServer((socket: Socket) => {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let req: DaemonRequest | null = null;
      try {
        req = JSON.parse(line) as DaemonRequest;
      } catch {
        socket.end(JSON.stringify({ ok: false, error: "bad json" }) + "\n");
        return;
      }
      handler(req)
        .then((resp) => {
          socket.write(JSON.stringify(resp) + "\n", () => socket.end());
        })
        .catch((e) => {
          socket.write(
            JSON.stringify({ ok: false, error: (e as Error).message }) + "\n",
            () => socket.end(),
          );
        });
    });
    socket.on("error", () => {
      /* client disconnected mid-write */
    });
  });
  server.listen(DAEMON_SOCKET_PATH);
  return server;
}
