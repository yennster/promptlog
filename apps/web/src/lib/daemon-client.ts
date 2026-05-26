import { createConnection } from "node:net";
import {
  DAEMON_SOCKET_PATH,
  type DaemonRequest,
  type DaemonResponse,
} from "@promptlog/shared";

export function sendToDaemon(req: DaemonRequest, timeoutMs = 3000) {
  return new Promise<DaemonResponse>((resolve) => {
    const socket = createConnection(DAEMON_SOCKET_PATH);
    let buf = "";
    let done = false;
    const finish = (r: DaemonResponse) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      socket.destroy();
      resolve(r);
    };
    const t = setTimeout(
      () => finish({ ok: false, error: `daemon timeout (buf=${buf.length})` }),
      timeoutMs,
    );

    socket.on("connect", () => socket.write(JSON.stringify(req) + "\n"));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try {
        finish(JSON.parse(buf.slice(0, nl).trim()) as DaemonResponse);
      } catch (e) {
        finish({
          ok: false,
          error: `daemon parse error: ${(e as Error).message}`,
        });
      }
    });
    socket.on("error", (err) =>
      finish({ ok: false, error: `daemon socket error: ${err.message}` }),
    );
  });
}
