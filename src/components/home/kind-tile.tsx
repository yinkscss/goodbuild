import { BadgeCheck, Blocks, ChartColumn, Coins, Gamepad2, Globe, HandCoins, HandHeart, PiggyBank, ShieldCheck, Ticket, Vote, type LucideIcon } from "lucide-react";

import { KIND_LABEL, type ContractKind } from "@/lib/contract-kind";
import { cn } from "@/lib/utils";

const ICONS: Record<ContractKind, LucideIcon> = {
  savings: PiggyBank,
  tips: HandCoins,
  tickets: Ticket,
  crowdfund: HandHeart,
  vote: Vote,
  badges: BadgeCheck,
  token: Coins,
  escrow: ShieldCheck,
  game: Gamepad2,
  dashboard: ChartColumn,
  site: Globe,
  custom: Blocks,
};

const GRADIENTS = [
  "linear-gradient(135deg, #F3EEF8 0%, #E2D2F0 100%)",
  "linear-gradient(135deg, #F3EEF8 0%, #EFE6F7 100%)",
];

/** Project card thumbnail: tinted tile with the contract-type icon and its name. */
export function KindTile({ kind, index = 0, className }: { kind: ContractKind; index?: number; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <div
      className={cn("relative flex h-[78px] items-center gap-3 overflow-hidden rounded-block px-4", className)}
      style={{ background: GRADIENTS[index % GRADIENTS.length] }}
    >
      <span className="relative grid size-10 shrink-0 place-items-center rounded-[12px] bg-surface text-violet shadow-card">
        <Icon className="size-5" strokeWidth={2} aria-hidden />
      </span>
      <Icon className="pointer-events-none absolute -right-3 -bottom-4 size-20 text-white/55" strokeWidth={1.5} aria-hidden />
      <span className="relative truncate text-xs font-semibold whitespace-nowrap text-violet">{KIND_LABEL[kind]}</span>
    </div>
  );
}
