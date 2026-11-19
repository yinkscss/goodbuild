import type { DeliveryPlan } from "@/server/db/schema";

export function deliveryFor(goal: string): DeliveryPlan {
  const milestones: DeliveryPlan["milestones"] = [{ id: "interface", title: "Working first interface", acceptance: ["Replace the starter with the requested interface and working local core interactions", "Clearly label local/demo functionality and keep live payments disabled"] }];
  if (/wallet|mini\s?pay/i.test(goal)) milestones.push({ id: "wallet", title: "Wallet connection", acceptance: ["Connect the wallet, show connection and network states, and preserve local functionality"] });
  if (/multiplayer|amongst|among themselves|play (?:with|against)|other players|each other|online game/i.test(goal)) milestones.push({ id: "multiplayer", title: "Multiplayer", acceptance: ["Implement joining and playing with another player, including turn synchronisation and recovery"] });
  if (/login|sign.in|authenticat|database|backend|upload|\bAPI\b|orders|checkout|email|notification|booking/i.test(goal)) milestones.push({ id: "integrations", title: "Remaining integrations", acceptance: ["Implement the requested saved-data, authentication and external integrations; report anything requiring configuration or live verification"] });
  if (/contract|stake|staking|G\$|token|escrow|payment|on.chain|mint|donat|tip jar|swap|vault|pool/i.test(goal)) milestones.push({ id: "payments", title: "On-chain features and payments", acceptance: ["Implement the remaining requested on-chain behaviour with contract tests", "Keep spending disabled until contracts are deployed and validated"] });
  return { goal, milestones, completed: 0 };
}

export function deliveryContext(plan: DeliveryPlan, index: number): string {
  const current = plan.milestones[index];
  return `DELIVERY CONTRACT (server enforced):\nOriginal request: ${plan.goal}\nBuild ONLY milestone ${index + 1}: ${current.title}.\nAcceptance: ${current.acceptance.join("; ")}\nRemaining after this: ${plan.milestones.slice(index + 1).map((m) => m.title).join(", ") || "none"}.\n${current.id === "interface" ? "Build a usable local/demo interface FIRST. No contracts, staking, wallet transactions, simulated live payments or multiplayer claims. Preserve the full goal for later milestones. Games must be playable locally, with reset and win/draw behaviour where applicable." : "Preserve the working interface. Implement only this milestone and its dependencies."}\n${/tic[- ]tac[- ]toe/i.test(plan.goal) ? 'For the board, use nine button elements data-gb-cell="0" through "8", a data-gb-status element reporting turn and winner/draw, and a button data-gb-restart that resets. Start with X, alternate O, prevent occupied moves and stop after a win. The server will independently play both wins and a draw.' : ""}
End by explaining what works and what remains; offer the next saved milestone. Never claim deferred features work.`;
}

export function milestoneAllows(plan: DeliveryPlan, index: number, name: string, args: Record<string, unknown>): boolean {
  if (plan.milestones[index]?.id === "payments") return true;
  const text = JSON.stringify(args);
  if (/writeContract|sendTransaction|signTransaction|transferAndCall|eth_send|wallet_send|createWalletClient/.test(text)) return false;
  if (["create_file", "edit_file", "delete_file", "rename_file"].includes(name)) {
    return ![args.path, args.from, args.to].some((p) => typeof p === "string" && (p.startsWith("contracts/") || ["src/lib/chain.ts", "src/lib/useWallet.ts"].includes(p)));
  }
  // Kits can seed contracts and wire live payments; the scoped setup supplies safe kits instead.
  return name !== "add_kit" || !/shop|board|swap|token|vault|dao/i.test(String(args.id ?? args.name));
}
