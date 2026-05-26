"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DeleteSessionButton({
  sessionId,
  sessionName,
  variant = "icon",
  redirectTo,
}: {
  sessionId: number;
  sessionName: string;
  variant?: "icon" | "full";
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = () =>
    startTransition(async () => {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setConfirming(false);
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });

  if (variant === "icon") {
    if (confirming) {
      return (
        <span className="inline-flex items-center gap-1 text-xs">
          <button
            type="button"
            disabled={pending}
            onClick={onDelete}
            className="rounded-md bg-destructive px-2 py-1 font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        aria-label={`Delete session ${sessionName}`}
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        className={cn(
          "rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="destructive" disabled={pending} onClick={onDelete}>
          Confirm delete
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <Button variant="outline" onClick={() => setConfirming(true)}>
      <Trash2 className="h-4 w-4" />
      Delete session
    </Button>
  );
}
