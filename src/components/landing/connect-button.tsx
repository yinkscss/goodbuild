"use client";

import { Button } from "@/components/ui/button";

/**
 * Disconnected wallet state: black pill with the pink dot (DESIGN_SYSTEM §3 Wallet states).
 * M2 replaces the click handler with the Privy connect modal via the useAuth adapter.
 */
export function ConnectButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <span className="size-1.5 rounded-full bg-pink" aria-hidden />
      Connect wallet
    </Button>
  );
}
