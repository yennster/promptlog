import { AxClient } from "./ax.js";
import { CaptureLoop } from "./capture.js";
import { startSocketServer } from "./socket.js";
import { rebuildFtsIndex } from "@promptlog/db/queries";
import type { DaemonResponse, DaemonStatus } from "@promptlog/shared";

// FTS5 index is content-bearing (not external-content), so it relies on
// insertPrompt to mirror rows. Anything that bypasses that — manual SQL
// inserts, partial writes from a crash, restore from a non-FTS-aware backup —
// can leave search broken. Re-mirroring on startup is idempotent and cheap.
const ftsRows = rebuildFtsIndex();
console.log(`[daemon] FTS index synced — ${ftsRows} rows`);

const ax = new AxClient();
const capture = new CaptureLoop(ax);

let lastError: string | null = null;

async function buildStatus(): Promise<DaemonStatus> {
  let granted = false;
  try {
    const r = await ax.axPermission();
    granted = r.ok && r.granted === true;
  } catch (e) {
    lastError = (e as Error).message;
  }
  return {
    recording: capture.isRecording(),
    currentSessionId: null, // not tracked here; web reads DB for that
    axPermissionGranted: granted,
    axBinaryPath: ax.binaryPath(),
    lastError,
  };
}

await startSocketServer(async (req): Promise<DaemonResponse> => {
  switch (req.kind) {
    case "status":
      return { ok: true, status: await buildStatus() };
    case "start-session":
      capture.start(req.sessionId);
      return { ok: true, status: await buildStatus() };
    case "stop-session":
      capture.stop();
      return { ok: true, status: await buildStatus() };
    case "reload-settings":
      capture.reloadSettings();
      return { ok: true };
    default:
      return { ok: false, error: "unknown request" };
  }
});

console.log("[daemon] listening on socket");
if (!ax.binaryExists()) {
  console.warn(
    `[daemon] ax-capture binary missing at ${ax.binaryPath()}. Run \`pnpm build:swift\`.`,
  );
} else {
  // Warm up so initial /status doesn't pay spawn cost.
  ax.ping().catch(() => {});
}

const shutdown = () => {
  capture.stop();
  ax.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
