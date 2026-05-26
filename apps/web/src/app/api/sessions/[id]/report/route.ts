import { NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getSession, getSessionPrompts } from "@promptlog/db/queries";
import { SessionReport } from "@/reports/SessionReport";
import { buildSessionWorkbook } from "@/reports/sessionWorkbook";
import { buildSessionsCsv } from "@/reports/csv";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sid = Number(id);
  if (!Number.isFinite(sid)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const session = getSession(sid);
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const promptList = getSessionPrompts(sid);
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "pdf";
  const safeName = session.name.replace(/[^a-z0-9-_]+/gi, "_");

  if (format === "csv") {
    const csv = buildSessionsCsv([{ session, prompts: promptList }]);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="audit-${session.id}-${safeName}.csv"`,
      },
    });
  }

  if (format === "xlsx") {
    const buf = await buildSessionWorkbook(session, promptList);
    return new Response(buf as unknown as BodyInit, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="audit-${session.id}-${safeName}.xlsx"`,
      },
    });
  }

  const pdf = await renderToBuffer(
    SessionReport({ session, prompts: promptList }),
  );
  return new Response(pdf as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="audit-${session.id}-${safeName}.pdf"`,
    },
  });
}
