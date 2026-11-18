import "server-only";
import { verifyMessage, type Address, type Hex } from "viem";
import {
  FLOWSTATE_CHAIN_ID,
  FLOWSTATE_COUNCIL,
  FLOWSTATE_ORIGIN,
  flowstateClaimMessage,
} from "@/lib/flowstate/config";
import { FlowstateError } from "./service";

/** Forwards only a short-lived, council-bound claim proof, never cookies or login tokens. */
export async function claimFlowstateEligibility(
  wallet: Address,
  input: { signature: Hex; issuedAt: number },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
) {
  if (
    !Number.isSafeInteger(input.issuedAt) ||
    input.issuedAt > now + 30_000 ||
    now - input.issuedAt > 5 * 60_000
  )
    throw new FlowstateError(
      "The voting setup signature expired. Please try again.",
      400,
    );
  if (
    !(await verifyMessage({
      address: wallet,
      message: flowstateClaimMessage(wallet, input.issuedAt),
      signature: input.signature,
    }))
  )
    throw new FlowstateError(
      "The signature does not match your signed-in wallet.",
      403,
    );
  const res = await fetchImpl(
    `${FLOWSTATE_ORIGIN}/api/flow-council/eligibility`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: wallet,
        chainId: FLOWSTATE_CHAIN_ID,
        councilId: FLOWSTATE_COUNCIL,
        signature: input.signature,
        issuedAt: input.issuedAt,
      }),
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    },
  );
  const data = await res.json();
  if (!res.ok || !data.success) {
    if (data.alreadyClaimed)
      throw new FlowstateError(
        "Your GoodDollar identity already enabled voting with another wallet. Use that wallet on FlowState; this wallet has not voted.",
      );
    if (data.notWhitelisted)
      throw new FlowstateError(
        "GoodDollar has not confirmed this wallet yet. Complete verification, then try again.",
        403,
      );
    throw new FlowstateError(
      "FlowState could not enable voting right now. Please wait a moment and retry.",
      503,
    );
  }
  return { success: true };
}
