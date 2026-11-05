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
  busy,
  onDeployed,
  onFix,
  onPublish,
  children,
}: {
  projectId: string;
  chainId: number;
  hasContracts: boolean;
  busy: boolean;
  /** Everything landed: the contract names. Empty after a partial failure (files still changed). */
  onDeployed: (deployed: string[]) => void;
  onFix: (prompt: string) => void;
  /** Offered once deployed: republishing is what puts the new addresses in the public app. */
  onPublish?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const deploy = useDeploy({ projectId, chainId, onDeployed });
  const { prepare, reset } = deploy;

  const value = React.useMemo<DeployContext>(
    () => ({
      open: () => {
        setOpen(true);
        void prepare();
      },
      blocked: !hasContracts ? "This project has no contract to deploy." : busy ? "Wait for the build to finish." : null,
    }),
    [prepare, hasContracts, busy],
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
  return React.useContext(Ctx) ?? { open: () => undefined, blocked: "Deploys aren't available here." };
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
