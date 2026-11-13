/** What went wrong in a simulation or a wallet request, in terms the deploy modal can act on. */
/** "uncertain": a transaction was sent and Celo hasn't confirmed it; it may still go through (GB-03). */
export type DeployErrorKind = "opcode" | "user_rejected" | "insufficient_funds" | "wrong_chain" | "revert" | "timeout" | "not_saved" | "uncertain" | "unknown";

export interface ClassifiedError {
  kind: DeployErrorKind;
  message: string;
}

function textOf(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string; details?: string; cause?: unknown; code?: number } | null;
  if (!e) return "";
  return [e.shortMessage, e.details, e.message, e.cause ? textOf(e.cause) : ""].filter(Boolean).join(" | ");
}

/**
 * Celo (geth) rejects bytecode with an opcode its hardfork doesn't define as "invalid opcode:
 * opcode 0x5e not defined" (MCOPY is 0x5e, TLOAD/TSTORE 0x5c/0x5d, PUSH0 0x5f). That is the one
 * case D17 answers with a rebuild for `paris`, so it is told apart from an ordinary revert.
 */
export const OPCODE_ERROR = /invalid opcode|opcode 0x[0-9a-f]+ not defined|undefined instruction|InvalidFEOpcode|invalid instruction/i;

/**
 * What to log for a failed step. A wallet's real reason is in `details` or further down the cause
 * chain, and viem's message puts the long transaction data first, so a cut-off message loses it.
 */
export function errorDetail(error: unknown, limit = 800): string {
  const parts: string[] = [];
  for (let e = error as { shortMessage?: string; details?: string; message?: string; code?: number; cause?: unknown } | null | undefined, depth = 0; e && depth < 6; e = e.cause as typeof e, depth++) {
    const line = [e.code !== undefined ? `[${e.code}]` : "", e.shortMessage ?? e.message?.split("\n")[0] ?? "", e.details ?? ""].filter(Boolean).join(" ");
    if (line && !parts.includes(line)) parts.push(line);
  }
  return parts.join(" <- ").slice(0, limit);
}

export function classifyDeployError(error: unknown): ClassifiedError {
  const text = textOf(error);
  const code = (error as { code?: number | string } | null)?.code;
  if (code === 4001 || /user rejected|user denied|rejected the request|cancelled|canceled/i.test(text)) {
    return { kind: "user_rejected", message: "You cancelled the request in your wallet." };
  }
  if (OPCODE_ERROR.test(text)) {
    return { kind: "opcode", message: "Celo rejected this contract's bytecode because it uses an instruction the network doesn't support yet." };
  }
  if (/insufficient funds|exceeds the balance|insufficient balance/i.test(text)) {
    return { kind: "insufficient_funds", message: "Your wallet doesn't have enough CELO to pay the network fee." };
  }
  if (/chain.*(mismatch|does not match)|wrong network|unrecognized chain/i.test(text)) {
    return { kind: "wrong_chain", message: "Your wallet is on a different network. Switch to the network you're deploying to." };
  }
  if (code === "rpc_timeout" || /took too long to respond|timed out|didn't answer in time/i.test(text)) {
    return { kind: "timeout", message: "Celo didn't answer in time, so nothing was sent and nothing was spent. Try again." };
  }
  if (/revert|execution reverted/i.test(text)) {
    return { kind: "revert", message: "The contract's constructor reverted, so deploying it would fail. Check the values it was given." };
  }
  return { kind: "unknown", message: "Something went wrong talking to the network. Try again." };
}
