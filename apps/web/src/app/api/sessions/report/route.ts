import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSession, getSessionPrompts } from "@promptlog/db/queries";
import { buildSessionsCsv, type SessionBundle } from "@/reports/csv";
import { buildMultiSessionWorkbook } from "@/reports/multiSessionWorkbook";
import { MultiSessionReport } from "@/reports/MultiSessionReport";

// Multi-session export: /api/sessions/report?ids=1,2,3&format=pdf|xlsx|csv
// IDs are comma-separated; order in the URL determines order in the report.
// Single-session export still lives at /api/sessions/[id]/report.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const format = url.searchParams.get("format") ?? "pdf";

  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no session ids" }, { status: 400 });
  }

  const bundles: SessionBundle[] = [];
  for (const id of ids) {
    const session = getSession(id);
    if (!session) continue;
    bundles.push({ session, prompts: getSessionPrompts(id) });
  }
  if (bundles.length === 0) {
    return NextResponse.json({ error: "no sessions found" }, { status: 404 });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const baseName = `promptlog-${bundles.length}-sessions-${stamp}`;

  if (format === "csv") {
    const csv = buildSessionsCsv(bundles);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${baseName}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const buf = await buildMultiSessionWorkbook(bundles);
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${baseName}.xlsx"`,
      },
    });
  }

  const pdf = await renderToBuffer(
    MultiSessionReport({ bundles, generatedAt: new Date() }),
  );
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${baseName}.pdf"`,
    },
  });
}
