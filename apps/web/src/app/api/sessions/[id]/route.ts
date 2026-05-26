import { NextResponse } from "next/server";
import { activeSession, deleteSession } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sid = Number(id);
  if (!Number.isFinite(sid)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  // If the user is deleting the active recording session, tell the daemon to
  // stop capturing first so it doesn't try to write to a removed session row.
  const active = activeSession();
  if (active && active.id === sid) {
    await sendToDaemon({ kind: "stop-session" });
  }
  const removed = deleteSession(sid);
  if (!removed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, session: removed });
}
