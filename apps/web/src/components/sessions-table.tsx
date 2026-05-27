"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@promptlog/db";
import type { TargetApp } from "@promptlog/shared";
import { Badge } from "@/components/ui/badge";
import { AppBadge } from "@/components/app-badge";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { cn, formatDateTime, formatDuration } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { DynamicDuration } from "@/components/dynamic-duration";

export interface SessionRow {
  session: Session;
  promptCount: number;
  apps: TargetApp[];
}

export function SessionsTable({ rows }: { rows: SessionRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const allChecked =
    rows.length > 0 && rows.every((r) => selected.has(r.session.id));
  const someChecked = selected.size > 0 && !allChecked;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.session.id)));
  }

  function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleteError(null);
    startDeleting(async () => {
      try {
        const res = await fetch(
          `/api/sessions?ids=${encodeURIComponent(ids.join(","))}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSelected(new Set());
        setConfirmingDelete(false);
        router.refresh();
      } catch (e) {
        setDeleteError((e as Error).message);
      }
    });
  }

  // Preserve user-visible order in the URL so the exported report matches what
  // they see on screen. The selection Set is unordered, so re-derive from rows.
  const idsParam = useMemo(
    () =>
      rows
        .map((r) => r.session.id)
        .filter((id) => selected.has(id))
        .join(","),
    [rows, selected],
  );

  return (
    <>
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-6 py-2 text-sm md:flex-row md:items-center md:justify-between">
          <span className="text-muted-foreground">
            {selected.size} session{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/sessions/report?ids=${idsParam}&format=pdf`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Export PDF
            </a>
            <a
              href={`/api/sessions/report?ids=${idsParam}&format=xlsx`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Export XLSX
            </a>
            <a
              href={`/api/sessions/report?ids=${idsParam}&format=csv`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Export CSV
            </a>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={bulkDelete}
                  className={cn(
                    buttonVariants({ variant: "destructive", size: "sm" }),
                  )}
                >
                  {isDeleting
                    ? "Deleting…"
                    : `Confirm delete ${selected.size}`}
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setConfirmingDelete(false)}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive",
                )}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelected(new Set());
                setConfirmingDelete(false);
              }}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Clear
            </button>
          </div>
          {deleteError && (
            <p className="text-xs text-destructive md:basis-full">
              Could not delete: {deleteError}
            </p>
          )}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground">
          <tr className="border-b border-border">
            <th className="w-10 px-4 py-2 text-left font-medium">
              <input
                type="checkbox"
                aria-label="Select all sessions"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={toggleAll}
                className="h-4 w-4 cursor-pointer rounded border-border bg-background"
              />
            </th>
            <th className="px-6 py-2 text-left font-medium">Name</th>
            <th className="px-6 py-2 text-left font-medium">Started</th>
            <th className="px-6 py-2 text-left font-medium">Duration</th>
            <th className="px-6 py-2 text-left font-medium">Prompts</th>
            <th className="px-6 py-2 text-left font-medium">Apps</th>
            <th className="px-6 py-2 text-left font-medium">Context</th>
            <th className="px-6 py-2 text-left font-medium">Status</th>
            <th className="px-2 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const s = row.session;
            const duration = s.endedAt
              ? s.endedAt.getTime() - s.startedAt.getTime()
              : Date.now() - s.startedAt.getTime();
            const checked = selected.has(s.id);
            return (
              <tr
                key={s.id}
                className={cn(
                  "border-b border-border last:border-0 hover:bg-accent/40",
                  checked && "bg-accent/30",
                )}
              >
                <td className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select session ${s.name}`}
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="h-4 w-4 cursor-pointer rounded border-border bg-background"
                  />
                </td>
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
                  <DynamicDuration startedAt={s.startedAt} endedAt={s.endedAt} />
                </td>
                <td className="px-6 py-3">{row.promptCount}</td>
                <td className="px-6 py-3">
                  {row.apps.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.apps.map((a) => (
                        <AppBadge key={a} app={a} />
                      ))}
                    </div>
                  )}
                </td>
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
    </>
  );
}
