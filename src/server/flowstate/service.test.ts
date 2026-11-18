// @vitest-environment node
import { expect, it, vi } from "vitest";
import { encodeFunctionData, type PublicClient } from "viem";
import fixture from "../../../test/fixtures/flowstate-runtime.json";
import {
  FLOWSTATE_ABI,
  FLOWSTATE_COUNCIL,
  GOODBUILDIT_RECIPIENT,
} from "@/lib/flowstate/config";
import {
  flowstateStatus,
  prepareFlowstateVote,
  confirmFlowstateVote,
  confirmExistingFlowstateSupport,
} from "./service";
const wallet = "0x1111111111111111111111111111111111111111" as const;
function client() {
  return {
    getCode: vi.fn(async () => fixture.runtime),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === "getWhitelistedRoot") return wallet;
      if (functionName === "recipients")
        return [GOODBUILDIT_RECIPIENT, BigInt(12)];
      if (functionName === "voters") return [wallet, BigInt(10)];
      if (functionName === "getVotes")
        return [
          { recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(2) },
          {
            recipient: "0x2222222222222222222222222222222222222222",
            amount: BigInt(5),
          },
        ];
      return 0;
    }),
    simulateContract: vi.fn(async () => ({})),
    estimateContractGas: vi.fn(async () => BigInt(100_000)),
    getGasPrice: vi.fn(async () => BigInt(1_000_000_000)),
    getBalance: vi.fn(async () => BigInt(1_000_000_000_000_000_000)),
    getTransaction: vi.fn(async () => ({
      from: wallet,
      to: FLOWSTATE_COUNCIL,
      value: BigInt(0),
      chainId: 42220,
      input: encodeFunctionData({
        abi: FLOWSTATE_ABI,
        functionName: "vote",
        args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(2) }]],
      }),
    })),
    getBlockNumber: vi.fn(async () => BigInt(102)),
    getTransactionReceipt: vi.fn(async () => ({
      status: "success",
      blockNumber: BigInt(100),
    })),
  };
}
it("reads actual ballot and simulates only an increase to the pinned project", async () => {
  const c = client();
  const status = await flowstateStatus(c as unknown as PublicClient, wallet);
  expect(status).toMatchObject({
    available: "3",
    support: "2",
    registered: true,
  });
  const prepared = await prepareFlowstateVote(
    c as unknown as PublicClient,
    wallet,
    BigInt(1),
  );
  expect(prepared.after).toBe("3");
  expect(c.simulateContract).toHaveBeenCalledWith(
    expect.objectContaining({
      address: FLOWSTATE_COUNCIL,
      account: wallet,
      args: [[{ recipient: GOODBUILDIT_RECIPIENT, amount: BigInt(3) }]],
    }),
  );
  expect(c.getTransaction).not.toHaveBeenCalled();
});
it("fails closed for changed bytecode and never simulates over-allocation", async () => {
  const c = client();
  c.getCode.mockResolvedValue("0x01");
  await expect(
    flowstateStatus(c as unknown as PublicClient, wallet),
  ).rejects.toThrow(/contract/);
  const good = client();
  await expect(
    prepareFlowstateVote(good as unknown as PublicClient, wallet, BigInt(4)),
  ).rejects.toThrow(/available/);
  expect(good.simulateContract).not.toHaveBeenCalled();
});
it("does not confirm another wallet, a reverted transaction or altered calldata", async () => {
  const hash = ("0x" + "a".repeat(64)) as `0x${string}`;
  const c = client();
  expect(
    await confirmFlowstateVote(c as unknown as PublicClient, wallet, hash),
  ).toMatchObject({ support: "2" });
  c.getTransaction.mockResolvedValue({
    ...(await c.getTransaction()),
    from: "0x3333333333333333333333333333333333333333",
  } as never);
  await expect(
    confirmFlowstateVote(c as unknown as PublicClient, wallet, hash),
  ).rejects.toThrow(/wallet/);
  const reverted = client();
  reverted.getTransactionReceipt.mockResolvedValue({
    status: "reverted",
    blockNumber: BigInt(100),
  });
  await expect(
    confirmFlowstateVote(reverted as unknown as PublicClient, wallet, hash),
  ).rejects.toThrow(/reverted/);
  const altered = client();
  altered.getTransaction.mockResolvedValue({
    ...(await altered.getTransaction()),
    input: encodeFunctionData({
      abi: FLOWSTATE_ABI,
      functionName: "vote",
      args: [[{ recipient: wallet, amount: BigInt(2) }]],
    }),
  } as never);
  await expect(
    confirmFlowstateVote(altered as unknown as PublicClient, wallet, hash),
  ).rejects.toThrow(/GoodBuildIt/);
});

it("waits for three confirmations for both transaction and existing-support proofs", async () => {
  const c = client();
  c.getBlockNumber.mockResolvedValue(BigInt(101));
  await expect(
    confirmFlowstateVote(
      c as unknown as PublicClient,
      wallet,
      ("0x" + "a".repeat(64)) as `0x${string}`,
    ),
  ).rejects.toThrow(/three/);
  const settled = client();
  const original = settled.readContract.getMockImplementation()!;
  settled.readContract.mockImplementation(async (args) =>
    args.functionName === "getVotes" &&
    (args as { blockNumber?: bigint }).blockNumber !== undefined
      ? []
      : original(args),
  );
  await expect(
    confirmExistingFlowstateSupport(settled as unknown as PublicClient, wallet),
  ).rejects.toThrow(/three/);
});
