"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Copy, ExternalLink, KeyRound, Loader2, LogOut, Wallet } from "lucide-react";

import { useSendGate } from "@/components/auth/send-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NETWORKS, isMainnetEnabled } from "@/config/networks";
import { useAuth, useWallet } from "@/lib/auth/context";
import { chainName, explorerAddressUrl, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The chain the app expects the wallet on right now (Stage 1: Celo Sepolia). */
export function expectedChainId(mainnet = isMainnetEnabled()): number {
  return mainnet ? NETWORKS.celo.chainId : NETWORKS["celo-sepolia"].chainId;
}

/**
 * Wallet states from DESIGN_SYSTEM §3: disconnected (black Connect wallet), connecting
 * (spinner, "Check your wallet"), connected (white pill, pink dot, address, Celo badge),
 * wrong network (warning "Switch to Celo"). Connected opens the account menu (AUTH.md Flow 7).
 */
export function WalletButton({ className, showNetwork = true }: { className?: string; showNetwork?: boolean }) {
  const auth = useAuth();
  const { openConnect } = useSendGate();
  const { wallet, isWrongNetwork, switchChain } = useWallet();
  const expected = expectedChainId();
  const [switching, setSwitching] = React.useState(false);

  if (!auth.ready) {
    return <span className={cn("h-11 w-40 rounded-full bg-surface shadow-card", className)} aria-hidden />;
  }

  if (auth.phase === "connecting" || auth.phase === "signing") {
    return (
      <Button variant="primary" className={className} disabled aria-live="polite">
        <Loader2 className="animate-spin" aria-hidden />
        Check your wallet
      </Button>
    );
  }

  if (!auth.user) {
    return (
      <Button variant="primary" className={className} onClick={openConnect}>
        <span className="size-1.5 rounded-full bg-pink" aria-hidden />
        Connect wallet
      </Button>
    );
  }

  if (wallet && isWrongNetwork(expected)) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <button
          type="button"
          onClick={async () => {
            setSwitching(true);
            try {
              await switchChain(expected);
            } finally {
              setSwitching(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full bg-warning/12 px-4 py-2.5 text-sm font-medium text-warning outline-none hover:bg-warning/18 focus-visible:shadow-focus"
        >
          {switching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}
          Switch to {NETWORKS[expected === NETWORKS.celo.chainId ? "celo" : "celo-sepolia"].label}
        </button>
        <AccountMenu compact />
      </div>
    );
  }

  return <AccountMenu className={className} showNetwork={showNetwork} />;
}

function AccountMenu({
  className,
  compact = false,
  showNetwork = true,
}: {
  className?: string;
  compact?: boolean;
  showNetwork?: boolean;
}) {
  const auth = useAuth();
  const router = useRouter();
  const { wallet: browserWallet, switchChain } = useWallet();
  const [copied, setCopied] = React.useState(false);
  if (!auth.user) return null;
  // The session is the source of truth; the browser wallet may be disconnected or locked.
  const wallet = browserWallet ?? {
    address: auth.user.wallet as `0x${string}`,
    chainId: null,
    kind: auth.user.walletKind,
    label: auth.user.walletKind === "embedded" ? "Email wallet" : "Wallet",
  };

  const explorer = explorerAddressUrl(wallet.chainId ?? expectedChainId(), wallet.address);
  const mainnet = isMainnetEnabled();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-full bg-surface py-1.5 pr-3 pl-1.5 text-sm font-medium shadow-card outline-none hover:bg-tint focus-visible:shadow-focus",
            className,
          )}
          aria-label={`Account ${wallet.address}`}
        >
          <span
            className="size-7 rounded-full"
            style={{ background: "conic-gradient(#592E81, #FF85D9, #E2D2F0, #592E81)" }}
            aria-hidden
          />
          {!compact && (
            <>
              <span className="size-1.5 rounded-full bg-pink" aria-hidden />
              <span className="font-mono text-[13px] whitespace-nowrap">{shortAddress(wallet.address)}</span>
              {showNetwork && wallet.chainId !== null && (
                <span className="rounded-full bg-tint px-2 py-0.5 text-[11px] font-semibold text-violet">
                  {chainName(wallet.chainId)}
                </span>
              )}
            </>
          )}
          <ChevronDown className="size-3.5 text-grey-600" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{wallet.kind === "embedded" ? "Email wallet" : wallet.label}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void navigator.clipboard?.writeText(wallet.address).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check className="mt-0.5 size-4 text-success" /> : <Copy className="mt-0.5 size-4 text-grey-600" />}
          <span className="font-mono text-[13px]">{shortAddress(wallet.address, 8, 6)}</span>
        </DropdownMenuItem>
        {explorer && (
          <DropdownMenuItem asChild>
            <a href={explorer} target="_blank" rel="noreferrer">
              <ExternalLink className="mt-0.5 size-4 text-grey-600" />
              View on explorer
            </a>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Network</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(wallet.chainId ?? "")} onValueChange={(v) => void switchChain(Number(v))}>
          <DropdownMenuRadioItem value={String(NETWORKS["celo-sepolia"].chainId)}>Celo Sepolia (testnet)</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={String(NETWORKS.celo.chainId)} disabled={!mainnet}>
            <span>
              <span className="block">Celo</span>
              {!mainnet && <span className="block text-xs text-grey-600">Mainnet unlocks later in Stage 1</span>}
            </span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <Wallet className="mt-0.5 size-4 text-grey-600" />
          <span>
            <span className="block">Credits and top-up</span>
            <span className="block text-xs text-grey-600">Coming with G$ credits</span>
          </span>
        </DropdownMenuItem>
        {auth.exportKey && (
          <DropdownMenuItem onSelect={() => void auth.exportKey?.()}>
            <KeyRound className="mt-0.5 size-4 text-grey-600" />
            Export private key
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await auth.signOut();
            router.push("/");
            router.refresh();
          }}
        >
          <LogOut className="mt-0.5 size-4 text-grey-600" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
