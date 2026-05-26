import { createConnection, createServer, type Socket } from "node:net";
import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import {
  DAEMON_SOCKET_PATH,
  type DaemonRequest,
  type DaemonResponse,
} from "@promptlog/shared";

export type Handler = (req: DaemonRequest) => Promise<DaemonResponse>;

// Probe the existing socket (if any) to see if a daemon is already listening.
// On tsx-watch reload the previous process can survive briefly while the new
// one starts up. Without this check the new daemon happily unlinks the socket
// file and creates a new one — but the old process is still bound to its own
// inode, still polling, still consuming an active session. Web requests then
// race between the two daemons. Ping-then-block fixes that.
async function pingExisting(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(DAEMON_SOCKET_PATH);
    const done = (result: boolean) => {
      try {
        sock.destroy();
      } catch {
        /* noop */
      }
      resolve(result);
    };
    sock.on("connect", () => {
      sock.write(JSON.stringify({ kind: "status" }) + "\n");
    });
    sock.on("data", () => done(true));
    sock.on("error", () => done(false));
    setTimeout(() => done(false), 500);
  });
}

export async function startSocketServer(handler: Handler) {
  mkdirSync(dirname(DAEMON_SOCKET_PATH), { recursive: true });
  if (await pingExisting()) {
    console.error(
      `[daemon] another daemon is already listening on ${DAEMON_SOCKET_PATH}. ` +
        `Refusing to start so we don't race for AX captures. Run \`pkill -f "tsx.*daemon"\` ` +
        `to clean up the orphan, then restart.`,
    );
    process.exit(1);
  }
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
