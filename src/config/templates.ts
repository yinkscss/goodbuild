/**
 * Starter templates surfaced in the prompt box (template picker and example chips).
 * Each chip fills the prompt with a specific, real-sounding brief (DESIGN_SYSTEM §7).
 * The ids line up with the v1 catalog in docs/CONTRACTS_AND_DEPLOYMENT.md §4.
 */
export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  examplePrompt: string;
}

export const TEMPLATES: StarterTemplate[] = [
  {
    id: "savings-circle",
    label: "G$ savings circle",
    description: "Rotating pot (ajo / esusu) for a fixed group",
    examplePrompt:
      "A weekly G$ savings circle for 12 members. Everyone deposits 50 G$ every Friday and the pot rotates to one member each week.",
  },
  {
    id: "tip-jar",
    label: "Community tip jar",
    description: "Collect G$ tips and split them between wallets",
    examplePrompt:
      "A tip jar for our football club that splits G$ 70/30 between the coach and the kit fund, with a public list of supporters.",
  },
  {
    id: "event-tickets",
    label: "Event tickets on Celo",
    description: "NFT tickets with check-in at the door",
    examplePrompt:
      "Tickets for a 300-person campus concert, sold for 200 G$ each as NFTs, with a check-in page for the door team.",
  },
  {
    id: "crowdfund",
    label: "Crowdfund with refund",
    description: "Goal and deadline, refunds if it falls short",
    examplePrompt:
      "A crowdfund for new library chairs: goal of 50,000 G$ by 30 November, and everyone gets refunded if we miss it.",
  },
  {
    id: "class-vote",
    label: "Class voting",
    description: "One wallet, one vote polls",
    examplePrompt:
      "A poll for our 400-level class to pick the excursion destination. One vote per verified student, results visible after it closes.",
  },
  {
    id: "event-badges",
    label: "NFT event badges",
    description: "Soulbound attendance badges",
    examplePrompt:
      "Soulbound attendance badges for our monthly builder meetups that organisers can mint to attendees' wallets.",
  },
];

/** The three chips the landing prompt box shows (DESIGN_SYSTEM §3). */
export const LANDING_CHIP_IDS = ["savings-circle", "tip-jar", "event-tickets"] as const;

export function getTemplate(id: string): StarterTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
