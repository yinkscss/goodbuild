"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { DeployModal } from "./deploy-modal";
import { useDeploy } from "./use-deploy";

interface DeployContext {
  /** Opens the modal and prepares the plan. */
  open: () => void;
  /** Why deploying isn't possible right now, or null. */
  blocked: string | null;
  /** Contracts already live on this project's chain. */
  deployed: string[];
}

const Ctx = React.createContext<DeployContext | null>(null);

/**
 * Mount once in the workspace. Any button inside can open the deploy modal through useDeployAction,
 * so the shared workspace files only need the provider and two buttons (M5 keeps its code here).
 */
export function DeployProvider({
  projectId,
  chainId,
  hasContracts,
  deployed,
  busy,
  onDeployed,
  onFix,
  onPublish,
  onSwitchChain,
  children,
}: {
  projectId: string;
  chainId: number;
  hasContracts: boolean;
  deployed: string[];
  busy: boolean;
  /** Everything landed: the contract names. Empty after a partial failure (files still changed). */
  onDeployed: (deployed: string[]) => void;
  onFix: (prompt: string) => void;
  /** Offered once deployed: republishing is what puts the new addresses in the public app. */
  onPublish?: () => void;
  /** Move the project to another network (saves it on the server and reloads the workspace). True when it moved. */
  onSwitchChain?: (chainId: number) => Promise<boolean>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const deploy = useDeploy({ projectId, chainId, onDeployed });
  const { prepare, reset } = deploy;
  const [switching, setSwitching] = React.useState(false);
  // The project moved to another network while the modal is open: plan again for it.
  const lastChain = React.useRef(chainId);
  React.useEffect(() => {
    if (lastChain.current === chainId) return;
    lastChain.current = chainId;
    if (open) {
      reset();
      void prepare();
    }
  }, [chainId, open, prepare, reset]);

  const value = React.useMemo<DeployContext>(
    () => ({
      open: () => {
        setOpen(true);
        void prepare();
      },
      deployed,
      blocked: !hasContracts ? "This project has no contract to deploy." : busy ? "Wait for the build to finish." : null,
    }),
    [prepare, hasContracts, busy, deployed],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <DeployModal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        deploy={deploy}
        chainId={chainId}
        switching={switching}
        onSwitchNetwork={
          onSwitchChain &&
          (async (next) => {
            setSwitching(true);
            try {
              await onSwitchChain(next);
            } finally {
              setSwitching(false);
            }
          })
        }
        onFix={(prompt) => {
          setOpen(false);
          reset();
          onFix(prompt);
        }}
        onPublish={
          onPublish &&
          (() => {
            setOpen(false);
            reset();
            onPublish();
          })
        }
      />
    </Ctx.Provider>
  );
}

export function useDeployAction(): DeployContext {
  return React.useContext(Ctx) ?? { open: () => undefined, blocked: "Deploys aren't available here.", deployed: [] };
}

/** The Deploy button for the workspace header and the chat's deploy card. */
export function DeployButton({ label = "Deploy", className, size }: { label?: string; className?: string; size?: "default" | "sm" }) {
  const { open, blocked } = useDeployAction();
  return (
    <Button variant="primary" size={size} className={className} disabled={Boolean(blocked)} title={blocked ?? "Sign and deploy from your wallet"} onClick={open}>
      {label}
    </Button>
  );
}
