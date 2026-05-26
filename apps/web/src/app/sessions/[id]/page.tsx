import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, getSessionPrompts } from "@promptlog/db/queries";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import { PromptList } from "@/components/prompt-list";
import { AppBadge } from "@/components/app-badge";
import { DeleteSessionButton } from "@/components/delete-session-button";
import type { TargetApp } from "@promptlog/shared";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sid = Number(id);
  const session = getSession(sid);
  if (!session) notFound();

  const promptList = getSessionPrompts(sid);
  const duration = session.endedAt
    ? session.endedAt.getTime() - session.startedAt.getTime()
    : Date.now() - session.startedAt.getTime();

  // Per-app breakdown: how many prompts came from each tool during this
  // session. Sessions can mix multiple apps, so this surfaces the split at
  // the top instead of forcing the user to scan every row.
  const promptsByApp = promptList.reduce<Record<TargetApp, number>>(
    (acc, p) => {
      acc[p.app] = (acc[p.app] ?? 0) + 1;
      return acc;
    },
    {} as Record<TargetApp, number>,
  );
  const appEntries = (Object.entries(promptsByApp) as [TargetApp, number][])
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← All sessions
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {session.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(session.startedAt)}
            {session.endedAt
              ? ` → ${formatDateTime(session.endedAt)}`
              : " · in progress"}
            {session.projectContext ? ` · ${session.projectContext}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/sessions/${session.id}/report?format=pdf`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Export PDF
          </a>
          <a
            href={`/api/sessions/${session.id}/report?format=xlsx`}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Export XLSX
          </a>
          <DeleteSessionButton
            sessionId={session.id}
            sessionName={session.name}
            variant="full"
            redirectTo="/"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Prompts" value={promptList.length} />
        <Stat label="Duration" value={formatDuration(duration)} />
        <Card>
          <CardContent className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Apps used
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {appEntries.length === 0 ? (
                <span className="text-sm text-muted-foreground">—</span>
              ) : (
                appEntries.map(([app, count]) => (
                  <div key={app} className="flex items-center gap-1.5">
                    <AppBadge app={app} />
                    <span className="text-sm tabular-nums text-muted-foreground">
                      × {count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompts</CardTitle>
          <CardDescription>
            One row per detected prompt. Click a row to expand.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {promptList.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No prompts captured yet. Send something in one of your AI apps
              while this session is active.
            </p>
          ) : (
            <PromptList prompts={promptList} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
