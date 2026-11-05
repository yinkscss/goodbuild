"use client";

import * as React from "react";
import { createPublicClient, http, type Abi, type Address, type EIP1193Provider, type Hex } from "viem";
import { celoSepolia } from "viem/chains";

import { Button } from "@/components/ui/button";
import { switchWalletChain, walletClientFor } from "@/lib/auth/wallet-client";
import { explorerAddressUrl } from "@/lib/deploy/explorer";
import { classifyDeployError } from "@/lib/deploy/errors";

type Stage = "idle" | "compiling" | "signing" | "mining" | "done" | "error";

const COPY: Record<Stage, string> = {
  idle: "",
  compiling: "Compiling…",
  signing: "Confirm in your wallet",
  mining: "Sending to Celo…",
  done: "",
  error: "",
};

export function TestGdDeploy() {
  const [stage, setStage] = React.useState<Stage>("idle");
  const [address, setAddress] = React.useState<Address | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const configured = process.env.NEXT_PUBLIC_TEST_GD_ADDRESS;
  const busy = stage === "compiling" || stage === "signing" || stage === "mining";

  async function deploy() {
    setError(null);
    try {
      const provider = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
      if (!provider) throw new Error("No browser wallet found. Install MetaMask, then reload.");
      setStage("compiling");
      const res = await fetch("/api/dev/test-gd", { method: "POST" });
      if (!res.ok) throw new Error("TestGoodDollar didn't compile. See the server log.");
      const { abi, bytecode } = (await res.json()) as { abi: Abi; bytecode: Hex };

      setStage("signing");
      const [account] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
      await switchWalletChain(walletClientFor(provider, account, null), celoSepolia.id);
      const client = walletClientFor(provider, account, celoSepolia.id);
      const hash = await client.deployContract({ abi, bytecode, account, chain: celoSepolia });

      setStage("mining");
      const receipt = await createPublicClient({ chain: celoSepolia, transport: http() }).waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("The deployment failed on-chain.");
      setAddress(receipt.contractAddress);
      setStage("done");
    } catch (e) {
      setStage("error");
      setError(e instanceof Error && !("shortMessage" in e) ? e.message : classifyDeployError(e).message);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="w-full max-w-[560px] rounded-card bg-surface p-6">
        <p className="eyebrow">Development only</p>
        <h1 className="display mt-2 text-[28px] font-extrabold">Deploy test G$</h1>
        <p className="mt-2 text-sm text-grey-600">
          Deploys GoodBuild&apos;s test token to Celo Sepolia from your browser wallet. You need a little testnet CELO from{" "}
          <a className="text-violet hover:underline" href="https://faucet.celo.org/celo-sepolia" target="_blank" rel="noreferrer">
            the faucet
          </a>
          . Do this once.
        </p>

        {configured && <p className="mt-4 rounded-block bg-tint px-4 py-3 text-sm text-violet-ink">Already set: {configured}. Deploying again creates a second token.</p>}

        {stage === "done" && address ? (
          <div className="mt-5 rounded-block bg-canvas p-4 text-sm">
            <p className="font-semibold">Test G$ is live</p>
            <p className="mt-2 text-grey-600">Add this to .env.local and to your host, then restart the server:</p>
            <code className="mt-2 block font-mono text-xs break-all">NEXT_PUBLIC_TEST_GD_ADDRESS={address}</code>
            <a className="mt-3 inline-block text-xs text-violet hover:underline" href={explorerAddressUrl(celoSepolia.id, address)} target="_blank" rel="noreferrer">
              View on the explorer
            </a>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-grey-600" aria-live="polite">
              {COPY[stage]}
            </p>
            <Button variant="primary" disabled={busy} onClick={() => void deploy()}>
              {stage === "error" ? "Try again" : "Deploy from my wallet"}
            </Button>
          </div>
        )}
        {error && (
          <p className="mt-4 rounded-block bg-canvas p-4 text-sm text-grey-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
