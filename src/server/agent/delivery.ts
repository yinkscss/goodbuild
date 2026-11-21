import type { DeliveryMilestone, DeliveryPlan } from "@/server/db/schema";

const INTERFACE: DeliveryMilestone = { id: "interface", title: "Working first interface", acceptance: ["Replace the starter with the requested interface and working local core interactions", "Clearly label local/demo functionality and keep live payments disabled"] };

/** The later milestones a request asks for, in delivery order. The interface milestone is never included. */
export function requestedMilestones(text: string): DeliveryMilestone[] {
  const milestones: DeliveryMilestone[] = [];
  if (/wallet|mini\s?pay/i.test(text)) milestones.push({ id: "wallet", title: "Wallet connection", acceptance: ["Connect the wallet, show connection and network states, and preserve local functionality", "Plug in GoodBuild's wallet pieces as they are: ConnectButton, useWallet() (account, networkName, onRightNetwork, wrongNetwork, switchNetwork) and, for G$, useGdBalance(); write no wallet, network or token code of your own"] });
  if (/multiplayer|amongst|among themselves|play (?:with|against)|other players|each other|online game/i.test(text)) milestones.push({ id: "multiplayer", title: "Multiplayer", acceptance: ["Implement joining and playing with another player, including turn synchronisation and recovery"] });
  if (/login|sign.in|authenticat|database|backend|upload|\bAPI\b|orders|checkout|email|notification|booking/i.test(text)) milestones.push({ id: "integrations", title: "Remaining integrations", acceptance: ["Implement the requested saved-data, authentication and external integrations; report anything requiring configuration or live verification"] });
  if (/contract|stake|staking|G\$|token|escrow|payment|on.chain|mint|donat|tip jar|swap|vault|pool/i.test(text)) milestones.push({ id: "payments", title: "On-chain features and payments", acceptance: ["Implement the remaining requested on-chain behaviour with contract tests", "Keep spending disabled until contracts are deployed and validated"] });
  return milestones;
}

export function deliveryFor(goal: string): DeliveryPlan {
  return { goal, milestones: [INTERFACE, ...requestedMilestones(goal)], completed: 0 };
}

/**
 * A later request can ask for work the first message didn't (D153). The plan was fixed by the first
 * message, so a portfolio site that later wanted a G$ tip jar could never reach the on-chain milestone.
 * Missing milestones the request asks for are added to the plan, and the first one the request asks for
 * that isn't completed yet is returned as `picked`, so the turn builds it. Already-completed milestones
 * are left alone: their scope is kept by `milestoneAllows`.
 */
export function extendDelivery(plan: DeliveryPlan, request: string): { plan: DeliveryPlan; picked: number; added: boolean } {
  const wanted = requestedMilestones(request);
  const missing = wanted.filter((w) => !plan.milestones.some((m) => m.id === w.id));
  const next = missing.length ? { ...plan, milestones: [...plan.milestones, ...missing] } : plan;
  const picked = next.milestones.findIndex((m, i) => i >= next.completed && wanted.some((w) => w.id === m.id));
  return { plan: next, picked, added: missing.length > 0 };
}

export function deliveryContext(plan: DeliveryPlan, index: number): string {
  const current = plan.milestones[index];
  return `DELIVERY CONTRACT (server enforced):\nOriginal request: ${plan.goal}\nBuild ONLY milestone ${index + 1}: ${current.title}.\nAcceptance: ${current.acceptance.join("; ")}\nRemaining after this: ${plan.milestones.slice(index + 1).map((m) => m.title).join(", ") || "none"}.\n${current.id === "interface" ? "Build a usable local/demo interface FIRST. No contracts, staking, wallet transactions, simulated live payments or multiplayer claims. Preserve the full goal for later milestones. Games must be playable locally, with reset and win/draw behaviour where applicable." : "Preserve the working interface. Implement only this milestone and its dependencies."}${current.id !== "payments" && onChainDelivered(plan) ? "\nThe on-chain milestone is already delivered: contract changes the request asks for are in scope." : ""}\n${/tic[- ]tac[- ]toe/i.test(plan.goal) ? 'For the board, use nine button elements data-gb-cell="0" through "8", a data-gb-status element reporting turn and winner/draw, and a button data-gb-restart that resets. Start with X, alternate O, prevent occupied moves and stop after a win. The server will independently play both wins and a draw.' : ""}
End by explaining what works and what remains; offer the next saved milestone. Never claim deferred features work.`;
}

/** What the builder may say about milestones (in the system prompt). Without it, a refused builder invented a project setting that doesn't exist. */
export const MILESTONE_FACTS = `GoodBuild picks the milestone from the person's own message: a request that names on-chain work (a contract, G$ payments, tips, staking, minting) starts the on-chain milestone, and "continue" starts the next saved one. There is no project setting, build-plan screen or switch for milestones; never tell the person to change one.`;

/** GoodBuild's wallet layer: it already works, so no milestone edits it. */
const WALLET_LAYER = ["src/lib/chain.ts", "src/lib/useWallet.ts"];

/**
 * The tool result a builder gets when a call is outside the current milestone. An edit to the wallet layer
 * gets "it already works, use it like this" (D162): in the first live run the wallet milestone's builder was
 * told to ask for the on-chain milestone, which can't help with connecting a wallet.
 */
export function scopeRefusal(plan: DeliveryPlan, index: number, args: Record<string, unknown> = {}): string {
  const title = plan.milestones[index]?.title ?? "current";
  const walletFile = [args.path, args.from, args.to].find((p): p is string => typeof p === "string" && WALLET_LAYER.includes(p));
  if (walletFile) {
    return `Refused by the server: ${walletFile} is GoodBuild's wallet layer. It already works (connecting, showing the account, switching to the right network) and it stays as it is. Do not retry it. Use it from your own components instead: useWallet() from src/lib/useWallet.ts gives {account, walletName, connect, disconnect, connecting, error, chainId, networkName, onRightNetwork, wrongNetwork, switchNetwork}; connect() asks the wallet for an account and switches it to the project's network; useGdBalance() from src/lib/goodbuild/gooddollar gives the G$ balance; chain and publicClient from src/lib/chain.ts read the chain. Show the full account address (or its first 6 and last 4 characters) once connected, and the error when there is one. If a check failed, fix the component that shows the wallet, not this file.`;
  }
  return `Refused by the server: this build is scoped to the "${title}" milestone, which cannot write contract files or wallet/chain wiring, or send transactions. Do not retry it. Keep the feature as a clearly labelled preview. Tell the person how to get it: send a new request that names the on-chain feature (for example "add a G$ tip jar contract"), and GoodBuild will start the on-chain milestone for it. There is no setting to change.`;
}

/** Whether an on-chain milestone has been delivered: its contract scope then stays on in later milestones. */
function onChainDelivered(plan: DeliveryPlan): boolean {
  return plan.milestones.slice(0, plan.completed).some((m) => m.id === "payments");
}

/** Whether a tool call fits the milestone. On-chain scope, once a payments milestone is current or delivered, stays on. */
export function milestoneAllows(plan: DeliveryPlan, index: number, name: string, args: Record<string, unknown>): boolean {
  if (plan.milestones[index]?.id === "payments") return true;
  if (onChainDelivered(plan)) return true;
  const text = JSON.stringify(args);
  if (/writeContract|sendTransaction|signTransaction|transferAndCall|eth_send|wallet_send|createWalletClient/.test(text)) return false;
  if (["create_file", "edit_file", "delete_file", "rename_file"].includes(name)) {
    return ![args.path, args.from, args.to].some((p) => typeof p === "string" && (p.startsWith("contracts/") || WALLET_LAYER.includes(p)));
  }
  // Kits can seed contracts and wire live payments; the scoped setup supplies safe kits instead.
  return name !== "add_kit" || !/shop|board|swap|token|vault|dao/i.test(String(args.id ?? args.name));
}
