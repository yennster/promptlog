import Link from "next/link";
import { activeSession, listSessions } from "@promptlog/db/queries";
import { sendToDaemon } from "@/lib/daemon-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecordPill } from "@/components/record-pill";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { formatDateTime, formatDuration } from "@/lib/utils";

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
            Press record to start auditing prompts in your AI desktop apps.
          </p>
        </div>
        <RecordPill activeSessionId={active?.id ?? null} />
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
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-6 py-2 text-left font-medium">Name</th>
                  <th className="px-6 py-2 text-left font-medium">Started</th>
                  <th className="px-6 py-2 text-left font-medium">Duration</th>
                  <th className="px-6 py-2 text-left font-medium">Prompts</th>
                  <th className="px-6 py-2 text-left font-medium">Context</th>
                  <th className="px-6 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((row) => {
                  const s = row.session;
                  const duration = s.endedAt
                    ? s.endedAt.getTime() - s.startedAt.getTime()
                    : Date.now() - s.startedAt.getTime();
                  return (
                    <tr
                      key={s.id}
                      className="border-b border-border last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-6 py-3">
                        <Link
                          href={`/sessions/${s.id}`}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {formatDateTime(s.startedAt)}
                      </td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {formatDuration(duration)}
                      </td>
                      <td className="px-6 py-3">{row.promptCount}</td>
                      <td className="px-6 py-3 text-muted-foreground">
                        {s.projectContext ?? "—"}
                      </td>
                      <td className="px-6 py-3">
                        {s.endedAt ? (
                          <Badge variant="secondary">Ended</Badge>
                        ) : (
                          <Badge>Active</Badge>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <DeleteSessionButton
                          sessionId={s.id}
                          sessionName={s.name}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
