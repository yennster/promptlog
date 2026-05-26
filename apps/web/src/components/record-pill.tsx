"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RecordPill({
  activeSessionId,
}: {
  activeSessionId: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [showForm, setShowForm] = useState(false);

  if (activeSessionId) {
    return (
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await fetch(`/api/sessions/${activeSessionId}/stop`, {
              method: "POST",
            });
            router.refresh();
          })
        }
      >
        <Square className="h-3 w-3 fill-current" />
        Stop recording
      </Button>
    );
  }

  if (!showForm) {
    return (
      <Button onClick={() => setShowForm(true)} disabled={pending}>
        <CircleDot className="h-4 w-4 text-destructive" />
        Record
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        placeholder="Session name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-44"
      />
      <Input
        placeholder="Project context (optional)"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        className="w-56"
      />
      <Button
        disabled={pending || !name.trim()}
        onClick={() =>
          startTransition(async () => {
            await fetch("/api/sessions/start", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: name.trim(),
                projectContext: context.trim() || null,
              }),
            });
            setShowForm(false);
            setName("");
            setContext("");
            router.refresh();
          })
        }
      >
        Start
      </Button>
      <Button variant="ghost" onClick={() => setShowForm(false)}>
        Cancel
      </Button>
    </div>
  );
}
