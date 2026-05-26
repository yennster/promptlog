import { NextResponse } from "next/server";
import { stopSession } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sid = Number(id);
  if (!Number.isFinite(sid)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const session = stopSession(sid);
  const daemon = await sendToDaemon({ kind: "stop-session" });
  return NextResponse.json({ session, daemon });
}
