"use client";

import { NETWORKS, type NetworkId } from "@/config/networks";
import { cn } from "@/lib/utils";

/** Segmented pill: Celo Sepolia (default) / Celo. Mainnet stays disabled behind a flag. */
export function NetworkToggle({
  value,
  onChange,
  mainnetEnabled,
}: {
  value: NetworkId;
  onChange: (id: NetworkId) => void;
  mainnetEnabled: boolean;
}) {
  const options: NetworkId[] = ["celo-sepolia", "celo"];
  return (
    <div role="radiogroup" aria-label="Network" className="flex rounded-full bg-tint p-1 text-xs font-medium">
      {options.map((id) => {
        const selected = value === id;
        const locked = id === "celo" && !mainnetEnabled;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={locked}
            title={locked ? "Mainnet unlocks after testnet (Stage 1 builds deploy to Celo Sepolia)" : undefined}
            onClick={() => onChange(id)}
            className={cn(
              "rounded-full px-3 py-1.5 transition-[background-color,color,box-shadow] duration-200 ease-gb outline-none focus-visible:shadow-focus",
              selected ? "bg-surface text-ink shadow-card" : "text-grey-600 hover:text-violet",
              locked && "cursor-not-allowed opacity-45 hover:text-grey-600",
            )}
          >
            {NETWORKS[id].label}
          </button>
        );
      })}
    </div>
  );
}
