import Link from "next/link";
import { activeSession, listSessions } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionsTable } from "@/components/sessions-table";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const sessions = listSessions();
  const active = activeSession();
  const daemonStatus = await sendToDaemon({ kind: "status" });
  const daemonOk = daemonStatus.ok === true;
  const axGranted =
    daemonStatus.ok && daemonStatus.status?.axPermissionGranted === true;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
          <p className="text-sm text-muted-foreground">
            Audit your local prompts to Claude, ChatGPT, Codex, and Antigravity.
          </p>
        </div>
      </header>

      {!daemonOk && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Daemon not running</CardTitle>
            <CardDescription>
              The capture daemon isn't reachable at the local socket. Run{" "}
              <code className="rounded bg-muted px-1">pnpm dev</code> from the
              repo root, or start the daemon with{" "}
              <code className="rounded bg-muted px-1">
                pnpm -C apps/daemon dev
              </code>
              .
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {daemonOk && !axGranted && (
        <Card className="border-yellow-500/40">
          <CardHeader>
            <CardTitle>Accessibility permission needed</CardTitle>
            <CardDescription>
              The capture helper needs Accessibility permission to read text
              from the target apps.{" "}
              <Link href="/settings" className="underline">
                Open Settings →
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sessions.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No sessions yet. Press record to start one.
            </p>
          ) : (
            <SessionsTable rows={sessions} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
