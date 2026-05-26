import ExcelJS from "exceljs";
import { TARGET_APP_LABEL, type TargetApp } from "@promptlog/shared";
import type { SessionBundle } from "./csv";

// Multi-session workbook: one Summary row per session, a flat Prompts sheet
// with session columns prepended (so the user can pivot/filter freely), and a
// global By-app aggregate that sums across the whole bundle. Distinct shape
// from the single-session workbook on purpose — the per-session 3-sheet view
// is great for one session but doesn't scale to dozens.
export async function buildMultiSessionWorkbook(
  bundles: SessionBundle[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Promptlog";
  wb.created = new Date();

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Session ID", key: "id", width: 12 },
    { header: "Name", key: "name", width: 36 },
    { header: "Started", key: "started", width: 22 },
    { header: "Ended", key: "ended", width: 22 },
    { header: "Project context", key: "ctx", width: 30 },
    { header: "Prompts", key: "n", width: 10 },
    { header: "Total cost (USD)", key: "cost", width: 16 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const { session, prompts } of bundles) {
    const cost = prompts.reduce((a, p) => a + (p.estCostUsd ?? 0), 0);
    summary.addRow({
      id: session.id,
      name: session.name,
      started: session.startedAt,
      ended: session.endedAt ?? "(in progress)",
      ctx: session.projectContext ?? "",
      n: prompts.length,
      cost: cost > 0 ? Number(cost.toFixed(6)) : null,
    });
  }

  const promptsSheet = wb.addWorksheet("Prompts");
  promptsSheet.columns = [
    { header: "Session ID", key: "sid", width: 10 },
    { header: "Session", key: "sname", width: 28 },
    { header: "Sent at", key: "sent_at", width: 22 },
    { header: "App", key: "app", width: 12 },
    { header: "Latency (ms)", key: "latency", width: 14 },
    { header: "Cost (USD)", key: "cost", width: 12 },
    { header: "Detected cwd", key: "cwd", width: 36 },
    { header: "Prompt", key: "prompt", width: 80 },
    { header: "Response snippet", key: "response", width: 80 },
  ];
  promptsSheet.getRow(1).font = { bold: true };
  for (const { session, prompts } of bundles) {
    for (const p of prompts) {
      promptsSheet.addRow({
        sid: session.id,
        sname: session.name,
        sent_at: p.sentAt,
        app: TARGET_APP_LABEL[p.app],
        latency: p.latencyMs ?? null,
        cost: p.estCostUsd ?? null,
        cwd: p.detectedCwd ?? "",
        prompt: p.promptText,
        response: p.responseSnippet ?? "",
      });
    }
  }
  promptsSheet.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const byApp = wb.addWorksheet("By app");
  byApp.columns = [
    { header: "App", key: "app", width: 14 },
    { header: "Prompts", key: "n", width: 10 },
    { header: "Avg latency (ms)", key: "lat", width: 18 },
    { header: "Total cost (USD)", key: "cost", width: 16 },
  ];
  byApp.getRow(1).font = { bold: true };
  const apps: TargetApp[] = ["claude", "chatgpt", "codex", "antigravity"];
  for (const app of apps) {
    const rows = bundles.flatMap((b) =>
      b.prompts.filter((p) => p.app === app),
    );
    if (!rows.length) continue;
    const lat = rows.map((r) => r.latencyMs ?? 0).filter((n) => n > 0);
    const avg = lat.length
      ? Math.round(lat.reduce((a, b) => a + b) / lat.length)
      : null;
    const cost = rows.reduce((a, p) => a + (p.estCostUsd ?? 0), 0);
    byApp.addRow({
      app: TARGET_APP_LABEL[app],
      n: rows.length,
      lat: avg,
      cost: cost > 0 ? Number(cost.toFixed(6)) : null,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
