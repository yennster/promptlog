import { NextResponse } from "next/server";
import { createSession, activeSession, stopSession } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    projectContext?: string | null;
  };
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  // Only one active session at a time.
  const existing = activeSession();
  if (existing) stopSession(existing.id);

  const session = createSession({
    name: body.name.trim(),
    projectContext: body.projectContext ?? null,
  });

  const daemon = await sendToDaemon({
    kind: "start-session",
    sessionId: session.id,
    projectContext: body.projectContext ?? undefined,
  });

  return NextResponse.json({ session, daemon });
}
