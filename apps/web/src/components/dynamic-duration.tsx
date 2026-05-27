"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

export interface DynamicDurationProps {
  startedAt: string | number | Date;
  endedAt: string | number | Date | null | undefined;
}

export function DynamicDuration({ startedAt, endedAt }: DynamicDurationProps) {
  const [mounted, setMounted] = useState(false);
  const startMs = new Date(startedAt).getTime();

  useEffect(() => {
    setMounted(true);
  }, []);

  const [duration, setDuration] = useState(() => {
    const endMs = endedAt ? new Date(endedAt).getTime() : startMs;
    return endMs - startMs;
  });

  useEffect(() => {
    if (endedAt) return;

    // Sync to exact client time immediately on mount
    setDuration(Date.now() - startMs);

    const timer = setInterval(() => {
      setDuration(Date.now() - startMs);
    }, 1000);

    return () => clearInterval(timer);
  }, [startMs, endedAt, mounted]);

  // If endedAt is set, it is completed and always stable.
  // If active (null) and not mounted, use 0s to guarantee matching SSR HTML.
  const displayDuration = (endedAt || mounted) ? duration : 0;

  return <>{formatDuration(displayDuration)}</>;
}
