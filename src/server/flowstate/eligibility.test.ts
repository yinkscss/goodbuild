// @vitest-environment node
import { expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  flowstateClaimMessage,
  FLOWSTATE_COUNCIL,
} from "@/lib/flowstate/config";
import { claimFlowstateEligibility } from "./eligibility";
it("forwards only a wallet-proven, time-bound claim to the fixed FlowState endpoint", async () => {
  const actor = privateKeyToAccount(generatePrivateKey());
  const issuedAt = Date.now();
  const signature = await actor.signMessage({
    message: flowstateClaimMessage(actor.address, issuedAt),
  });
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ success: true })),
  );
  await claimFlowstateEligibility(
    actor.address,
    { signature, issuedAt },
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://flowstate.network/api/flow-council/eligibility");
  expect(JSON.parse(String(init.body))).toMatchObject({
    councilId: FLOWSTATE_COUNCIL,
    address: actor.address,
    chainId: 42220,
  });
  expect(init.headers).toEqual({ "Content-Type": "application/json" });
  const other = privateKeyToAccount(generatePrivateKey());
  await expect(
    claimFlowstateEligibility(other.address, { signature, issuedAt }, fetcher),
  ).rejects.toThrow(/signature/i);
  await expect(
    claimFlowstateEligibility(
      actor.address,
      { signature, issuedAt },
      fetcher,
      issuedAt + 300001,
    ),
  ).rejects.toThrow(/expired/);
  expect(fetcher).toHaveBeenCalledOnce();
});
it("does not treat an upstream identity conflict as membership or a vote", async () => {
  const actor = privateKeyToAccount(generatePrivateKey());
  const issuedAt = Date.now();
  const signature = await actor.signMessage({
    message: flowstateClaimMessage(actor.address, issuedAt),
  });
  await expect(
    claimFlowstateEligibility(
      actor.address,
      { signature, issuedAt },
      async () => new Response(JSON.stringify({ alreadyClaimed: true })),
    ),
  ).rejects.toThrow(/another wallet/);
});
