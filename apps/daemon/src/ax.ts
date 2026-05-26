import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
// Prefer the .app-bundled binary (gets its own TCC identity in macOS Privacy
// settings). Fall back to the raw swift build output for development.
const BUNDLED_PATH = resolve(
  here,
  "../../ax-capture/AxCapture.app/Contents/MacOS/ax-capture",
);
const RAW_PATH = resolve(here, "../../ax-capture/.build/release/ax-capture");
const BINARY_PATH = existsSync(BUNDLED_PATH) ? BUNDLED_PATH : RAW_PATH;

export interface AxResponse {
  ok: boolean;
  [k: string]: unknown;
}

export class AxClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private queue: Array<(resp: AxResponse) => void> = [];
  private starting: Promise<void> | null = null;

  binaryExists() {
    return existsSync(BINARY_PATH);
  }

  binaryPath() {
    return BINARY_PATH;
  }

  private ensure(): Promise<void> {
    if (this.proc && !this.proc.killed) return Promise.resolve();
    if (this.starting) return this.starting;
    if (!this.binaryExists()) {
      return Promise.reject(
        new Error(
          `ax-capture binary not found at ${BINARY_PATH}. Run \`pnpm build:swift\` from the repo root.`,
        ),
      );
    }
    this.starting = new Promise((res, rej) => {
      const proc = spawn(BINARY_PATH, [], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      proc.on("error", (err) => {
        this.starting = null;
        this.proc = null;
        rej(err);
      });
      proc.on("exit", () => {
        this.proc = null;
        // Reject anything outstanding.
        while (this.queue.length) {
          const r = this.queue.shift();
          r?.({ ok: false, error: "ax-capture exited" });
        }
      });
      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, nl).trim();
          this.buf = this.buf.slice(nl + 1);
          if (!line) continue;
          const waiter = this.queue.shift();
          if (!waiter) continue;
          try {
            waiter(JSON.parse(line) as AxResponse);
          } catch (e) {
            waiter({
              ok: false,
              error: `ax-capture parse error: ${(e as Error).message}: ${line.slice(0, 200)}`,
            });
          }
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        if (chunk.trim()) console.error("[ax-capture stderr]", chunk.trim());
      });
      this.proc = proc;
      this.starting = null;
      res();
    });
    return this.starting;
  }

  async cmd(line: string): Promise<AxResponse> {
    await this.ensure();
    if (!this.proc) return { ok: false, error: "ax-capture not running" };
    return new Promise<AxResponse>((resolve) => {
      this.queue.push(resolve);
      this.proc!.stdin.write(line + "\n");
    });
  }

  ping() {
    return this.cmd("ping");
  }

  axPermission() {
    return this.cmd("ax-permission");
  }

  promptAxPermission() {
    return this.cmd("ax-permission-prompt");
  }

  focusedApp() {
    return this.cmd("focused-app");
  }

  runningBundleIds() {
    return this.cmd("running");
  }

  snapshot(bundleId: string) {
    return this.cmd(`snapshot ${bundleId}`);
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.stdin.write("quit\n");
      } catch {
        /* noop */
      }
      this.proc.kill();
      this.proc = null;
    }
  }
}
