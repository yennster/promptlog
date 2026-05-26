import ExcelJS from "exceljs";
import type { Prompt, Session } from "@promptlog/db";
import { TARGET_APP_LABEL } from "@promptlog/shared";

export async function buildSessionWorkbook(
  session: Session,
  promptList: Prompt[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Promptlog";
  wb.created = new Date();

  const duration = session.endedAt
    ? session.endedAt.getTime() - session.startedAt.getTime()
    : Date.now() - session.startedAt.getTime();

  // Summary
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Field", key: "k", width: 24 },
    { header: "Value", key: "v", width: 60 },
  ];
  summary.addRows([
    { k: "Session", v: session.name },
    { k: "Session ID", v: session.id },
    { k: "Started", v: session.startedAt },
    { k: "Ended", v: session.endedAt ?? "(in progress)" },
    { k: "Duration (ms)", v: duration },
    { k: "Project context", v: session.projectContext ?? "" },
    { k: "Total prompts", v: promptList.length },
  ]);
  summary.getRow(1).font = { bold: true };

  // Prompts
  const prompts = wb.addWorksheet("Prompts");
  prompts.columns = [
    { header: "Sent at", key: "sent_at", width: 22 },
    { header: "App", key: "app", width: 12 },
    { header: "Latency (ms)", key: "latency", width: 14 },
    { header: "Detected cwd", key: "cwd", width: 40 },
    { header: "Prompt", key: "prompt", width: 80 },
    { header: "Response snippet", key: "response", width: 80 },
  ];
  prompts.getRow(1).font = { bold: true };
  for (const p of promptList) {
    prompts.addRow({
      sent_at: p.sentAt,
      app: TARGET_APP_LABEL[p.app],
      latency: p.latencyMs ?? null,
      cwd: p.detectedCwd ?? "",
      prompt: p.promptText,
      response: p.responseSnippet ?? "",
    });
  }
  prompts.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  // By app
  const byApp = wb.addWorksheet("By app");
  byApp.columns = [
    { header: "App", key: "app", width: 14 },
    { header: "Prompts", key: "n", width: 10 },
    { header: "Avg latency (ms)", key: "lat", width: 18 },
  ];
  byApp.getRow(1).font = { bold: true };
  const apps = ["claude", "chatgpt", "codex", "antigravity"] as const;
  for (const app of apps) {
    const rows = promptList.filter((p) => p.app === app);
    if (!rows.length) continue;
    const lat = rows.map((r) => r.latencyMs ?? 0).filter((n) => n > 0);
    const avg = lat.length
      ? Math.round(lat.reduce((a, b) => a + b) / lat.length)
      : null;
    byApp.addRow({
      app: TARGET_APP_LABEL[app],
      n: rows.length,
      lat: avg,
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
