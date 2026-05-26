import { NextResponse } from "next/server";
import { activeSession, deleteSession } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";

// Bulk delete: DELETE /api/sessions?ids=1,2,3
//
// Single-session delete still lives at /api/sessions/[id]. This endpoint is
// for the home-page multi-select toolbar — same semantics, just looped. If
// any of the deleted sessions is the active recording target, the daemon is
// told to stop first.
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) {
    return NextResponse.json({ error: "no session ids" }, { status: 400 });
  }

  const active = activeSession();
  if (active && ids.includes(active.id)) {
    await sendToDaemon({ kind: "stop-session" });
  }

  const deleted: number[] = [];
  const missing: number[] = [];
  for (const id of ids) {
    const removed = deleteSession(id);
    if (removed) deleted.push(id);
    else missing.push(id);
  }

  return NextResponse.json({ ok: true, deleted, missing });
}
