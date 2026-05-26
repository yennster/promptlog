import { TARGET_APP_LABEL, type TargetApp } from "@promptlog/shared";
import { cn } from "@/lib/utils";

// Brand-aligned tints so multi-app sessions are scannable at a glance. The
// background is kept at 10% alpha so the pill blends with the dark theme.
const APP_STYLES: Record<TargetApp, string> = {
  claude:
    "bg-orange-500/15 text-orange-300 border-orange-500/30",
  chatgpt:
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  codex:
    "bg-violet-500/15 text-violet-300 border-violet-500/30",
  antigravity:
    "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

export function AppBadge({
  app,
  className,
}: {
  app: TargetApp;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        APP_STYLES[app],
        className,
      )}
    >
      {TARGET_APP_LABEL[app]}
    </span>
  );
}
