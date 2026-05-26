"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Prompt } from "@promptlog/db";
import { AppBadge } from "@/components/app-badge";
import { cn, formatDuration, truncate } from "@/lib/utils";

function formatRowTime(d: Date) {
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function PromptList({ prompts }: { prompts: Prompt[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <ul className="divide-y divide-border">
      {prompts.map((p) => {
        const open = openId === p.id;
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => setOpenId(open ? null : p.id)}
              className="grid w-full grid-cols-[16px_minmax(150px,auto)_minmax(80px,auto)_minmax(70px,auto)_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-accent/40"
              aria-expanded={open}
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              <span className="whitespace-nowrap text-muted-foreground">
                {formatRowTime(p.sentAt)}
              </span>
              <AppBadge app={p.app} className="justify-self-start" />
              <span className="whitespace-nowrap text-muted-foreground">
                {formatDuration(p.latencyMs)}
              </span>
              <span className="truncate">
                {truncate(p.promptText.replace(/\s+/g, " "), 120) || "—"}
              </span>
            </button>

            {open && (
              <div className="space-y-4 border-t border-border bg-background/40 px-12 py-4 text-sm">
                <Field label="Prompt" value={p.promptText} />
                <Field
                  label="Response snippet"
                  value={p.responseSnippet ?? "(no response captured)"}
                  muted={!p.responseSnippet}
                />
                {p.detectedCwd && (
                  <Field label="Detected cwd" value={p.detectedCwd} mono />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Field({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "whitespace-pre-wrap break-words",
          mono && "font-mono text-xs",
          muted && "text-muted-foreground italic",
        )}
      >
        {value}
      </div>
    </div>
  );
}
