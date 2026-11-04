"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Re-runs the server render for the current page. */
export function RetryButton() {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
      <RotateCw className={pending ? "animate-spin" : undefined} />
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
}
