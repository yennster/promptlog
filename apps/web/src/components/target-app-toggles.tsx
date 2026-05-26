"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TARGET_APP_LABEL, type TargetApp } from "@promptlog/shared";
import { Switch } from "@/components/ui/switch";
import { AppBadge } from "@/components/app-badge";
import type { Settings } from "@/lib/settings";

export function TargetAppToggles({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.enabledApps);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function toggle(app: TargetApp, next: boolean) {
    // Optimistic update — flip the local toggle immediately, then POST. If the
    // request fails we roll back so the UI matches the server.
    const previous = enabled;
    const updated = { ...enabled, [app]: next };
    setEnabled(updated);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...settings, enabledApps: updated }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refresh server components so anything depending on settings sees the
      // new state. The daemon also reloads via the POST handler.
      startTransition(() => router.refresh());
    } catch (e) {
      setEnabled(previous);
      setError((e as Error).message);
    }
  }

  const apps = Object.keys(TARGET_APP_LABEL) as TargetApp[];
  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {apps.map((app) => {
          const id = `toggle-${app}`;
          return (
            <li key={app} className="flex items-center justify-between">
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2"
              >
                <AppBadge app={app} />
              </label>
              <Switch
                id={id}
                checked={!!enabled[app]}
                onCheckedChange={(v) => toggle(app, v)}
                disabled={isPending}
                aria-label={`Toggle ${TARGET_APP_LABEL[app]} capture`}
              />
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-xs text-destructive">
          Could not save settings: {error}
        </p>
      )}
    </div>
  );
}
