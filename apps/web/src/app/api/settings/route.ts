import { NextResponse } from "next/server";
import { readSettings, writeSettings, type Settings } from "@/lib/settings";
import { sendToDaemon } from "@/lib/daemon-client";

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: Request) {
  const body = (await req.json()) as Settings;
  writeSettings(body);
  await sendToDaemon({ kind: "reload-settings" });
  return NextResponse.json({ ok: true });
}
