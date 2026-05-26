// CLI for poking at the ax-capture binary and the adapters' filtering
// pipeline. Commands:
//   snapshot <app>            One-shot snapshot, print raw + cleaned blob.
//   live <app>                Continuously poll, simulate the capture-loop's
//                             stability/echo logic, print transitions.
//   record <app> <file> [s]   Poll every 250ms for <s> seconds (default 30),
//                             write [{ ts, snap }] to file as JSON.
//   replay <fixture> [prompt] Run extractAssistantResponse over each snapshot
//                             in the fixture, print before/after diff.
//
// `app` is one of: claude, chatgpt, codex, antigravity.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  TARGET_APP_BUNDLE_IDS,
  type TargetApp,
} from "@promptlog/shared";
import { AxClient } from "../src/ax.js";
import { extractAssistantResponse, stripChrome } from "../src/adapters.js";

interface RecordedSnap {
  ts: number;
  bundleId: string;
  composer: string;
  lastAssistantText: string;
}

interface Fixture {
  app: TargetApp;
  capturedAt: string;
  snaps: RecordedSnap[];
}

const APPS: TargetApp[] = ["claude", "chatgpt", "codex", "antigravity"];

function parseApp(s: string | undefined): TargetApp {
  if (!s || !APPS.includes(s as TargetApp)) {
    throw new Error(`bad app: ${s} (want one of ${APPS.join(",")})`);
  }
  return s as TargetApp;
}

async function getSnap(
  client: AxClient,
  app: TargetApp,
): Promise<RecordedSnap | null> {
  for (const bundleId of TARGET_APP_BUNDLE_IDS[app]) {
    const r = await client.snapshot(bundleId);
    if (!r.ok) continue;
    return {
      ts: Date.now(),
      bundleId,
      composer: ((r.composer as string | undefined) ?? "").trim(),
      lastAssistantText: (
        (r.lastAssistantText as string | undefined) ?? ""
      ).trim(),
    };
  }
  return null;
}

function dump(title: string, text: string) {
  console.log(`\n=== ${title} (${text.length} chars) ===`);
  console.log(text || "(empty)");
}

async function cmdSnapshot(app: TargetApp) {
  const client = new AxClient();
  const snap = await getSnap(client, app);
  client.stop();
  if (!snap) {
    console.log(`no snapshot for ${app} (app probably not running)`);
    return;
  }
  console.log(`bundleId=${snap.bundleId}`);
  dump("composer", snap.composer);
  dump("raw lastAssistantText", snap.lastAssistantText);
  dump("stripped (no prompt anchor)", stripChrome(app, snap.lastAssistantText));
}

async function cmdLive(app: TargetApp) {
  const client = new AxClient();
  let prevAssistant = "";
  let prevComposer = "";
  let tickCount = 0;
  console.log(`watching ${app} (Ctrl-C to stop)…`);
  const STABLE_MS = 1500;
  let stableSince = 0;
  let pendingPrompt = "";
  for (;;) {
    const snap = await getSnap(client, app);
    if (!snap) {
      await sleep(500);
      continue;
    }
    tickCount += 1;
    const composerChanged = snap.composer !== prevComposer;
    const assistantChanged = snap.lastAssistantText !== prevAssistant;

    const sent = prevComposer.length >= 2 && snap.composer.length === 0;
    if (sent) {
      pendingPrompt = prevComposer;
      stableSince = 0;
      console.log(`\n[t=${tickCount}] SENT prompt="${preview(pendingPrompt)}"`);
    }

    if (pendingPrompt) {
      const cleaned = stripChrome(app, snap.lastAssistantText);
      const residual = cleaned.replace(pendingPrompt, "").trim();
      const isEcho =
        cleaned.includes(pendingPrompt) && residual.length < 20;
      if (assistantChanged) stableSince = Date.now();
      const stableMs = stableSince ? Date.now() - stableSince : -1;
      console.log(
        `[t=${tickCount}] changed=${assistantChanged} echo=${isEcho} stableMs=${stableMs} cleaned=${cleaned.length} preview="${preview(cleaned)}"`,
      );
      if (!isEcho && stableMs >= STABLE_MS && cleaned.length > 0) {
        const text = extractAssistantResponse(
          app,
          snap.lastAssistantText,
          pendingPrompt,
        );
        console.log(`[t=${tickCount}] FINALIZE response="${preview(text, 200)}"`);
        pendingPrompt = "";
        stableSince = 0;
      }
    } else if (assistantChanged) {
      console.log(
        `[t=${tickCount}] (idle) assistant changed len=${snap.lastAssistantText.length}`,
      );
    } else if (composerChanged) {
      console.log(
        `[t=${tickCount}] composer="${preview(snap.composer, 60)}"`,
      );
    }

    prevAssistant = snap.lastAssistantText;
    prevComposer = snap.composer;
    await sleep(250);
  }
}

async function cmdRecord(app: TargetApp, file: string, seconds: number) {
  const client = new AxClient();
  const start = Date.now();
  const snaps: RecordedSnap[] = [];
  console.log(`recording ${app} for ${seconds}s → ${file}`);
  while (Date.now() - start < seconds * 1000) {
    const s = await getSnap(client, app);
    if (s) {
      snaps.push(s);
      process.stdout.write(`.`);
    } else {
      process.stdout.write(`x`);
    }
    await sleep(250);
  }
  client.stop();
  const fix: Fixture = {
    app,
    capturedAt: new Date().toISOString(),
    snaps,
  };
  writeFileSync(resolve(file), JSON.stringify(fix, null, 2));
  console.log(`\nwrote ${snaps.length} snaps`);
}

function cmdReplay(file: string, promptText: string | undefined) {
  if (!existsSync(file)) {
    console.error(`fixture not found: ${file}`);
    process.exit(1);
  }
  const fix: Fixture = JSON.parse(readFileSync(file, "utf8"));
  const prompt = promptText ?? "";
  console.log(`replaying ${fix.snaps.length} snaps from ${file} (app=${fix.app})`);
  if (prompt) console.log(`prompt="${prompt}"`);
  let prev = "";
  for (let i = 0; i < fix.snaps.length; i++) {
    const s = fix.snaps[i];
    if (s.lastAssistantText === prev) continue;
    prev = s.lastAssistantText;
    const cleaned = stripChrome(fix.app, s.lastAssistantText);
    const extracted = extractAssistantResponse(
      fix.app,
      s.lastAssistantText,
      prompt,
    );
    console.log(`\n--- snap[${i}] t+${s.ts - fix.snaps[0].ts}ms composer="${preview(s.composer, 60)}" ---`);
    console.log(`  raw  (${s.lastAssistantText.length}): ${preview(s.lastAssistantText, 200)}`);
    console.log(`  clean(${cleaned.length}): ${preview(cleaned, 200)}`);
    console.log(`  extr (${extracted.length}): ${preview(extracted, 200)}`);
  }
}

function preview(s: string, n = 80): string {
  return s.replace(/\n/g, " ⏎ ").slice(0, n);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "snapshot":
      await cmdSnapshot(parseApp(rest[0]));
      break;
    case "live":
      await cmdLive(parseApp(rest[0]));
      break;
    case "record":
      await cmdRecord(
        parseApp(rest[0]),
        rest[1] ?? `${rest[0]}-${Date.now()}.json`,
        rest[2] ? Number(rest[2]) : 30,
      );
      break;
    case "replay":
      cmdReplay(rest[0], rest[1]);
      break;
    default:
      console.error(
        "usage:\n" +
          "  ax-debug snapshot <app>\n" +
          "  ax-debug live <app>\n" +
          "  ax-debug record <app> <file> [seconds]\n" +
          "  ax-debug replay <fixture-file> [prompt-text]",
      );
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
