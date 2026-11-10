"use client";

import { formatClock, useElapsed, WaitNote, WaveDots } from "@/components/ui/wait";

/** What the first wait says at this many seconds (wait-state pick B1). Words follow what really happens. */
export function firstWaitCopy(seconds: number, ahead = 0): string {
  if (ahead > 1) return `${ahead} builds are ahead of yours.`;
  if (ahead === 1) return "Another build is running. You're next in line.";
  if (seconds >= 45) return "Taking longer than usual.";
  if (seconds >= 10) return "Lining up your first build";
  if (seconds >= 2) return "Setting up your project";
  return "Getting started…";
}

/** Status line for the gap between sending a prompt and the first build event. */
/** `ahead` is how many builds run or wait before this project's next one. */
export function FirstWait({ ahead }: { ahead?: number }) {
  const seconds = useElapsed(true);
  return (
    <div className="grid gap-2" role="status">
      <p className="flex items-center gap-2.5 text-sm text-grey-600">
        <WaveDots />
        <span className="font-medium text-ink">{firstWaitCopy(seconds, ahead)}</span>
        {seconds >= 2 && <span className="ml-auto font-mono text-[11px]">{formatClock(seconds)}</span>}
      </p>
      {seconds >= 45 && <WaitNote tone="calm">Your idea is saved, so you can close this tab and come back.</WaitNote>}
    </div>
  );
}
