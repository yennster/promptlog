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
import { DeleteSessionButton } from "@/components/delete-session-button";

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

      <div className="grid grid-cols-2 gap-4">
        <Stat label="Prompts" value={promptList.length} />
        <Stat label="Duration" value={formatDuration(duration)} />
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
