"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/utils";

export interface DynamicDurationProps {
  startedAt: string | number | Date;
  endedAt: string | number | Date | null | undefined;
}

export function DynamicDuration({ startedAt, endedAt }: DynamicDurationProps) {
  const startMs = new Date(startedAt).getTime();
  const [duration, setDuration] = useState(() => {
    const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
    return endMs - startMs;
  });

  useEffect(() => {
    if (endedAt) return; // session ended, static duration

    const timer = setInterval(() => {
      setDuration(Date.now() - startMs);
    }, 1000);

    return () => clearInterval(timer);
  }, [startMs, endedAt]);

  return <>{formatDuration(duration)}</>;
}
