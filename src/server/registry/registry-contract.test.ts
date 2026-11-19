// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeEventLog, encodeDeployData, encodeFunctionData, getAddress, zeroAddress, zeroHash, type Abi, type Hex } from "viem";

import { LocalChain } from "@/server/deploy/local-chain";
import { compileRegistry } from "../../../scripts/compile-credits.mjs";

const ADMIN = getAddress("0x00000000000000000000000000000000000ad111");
const RECORDER = getAddress("0x0000000000000000000000000000000000c0de01");
const STRANGER = getAddress("0x00000000000000000000000000000000baadf00d");
const B = `0x${"1".repeat(64)}` as Hex;
const A = `0x${"2".repeat(64)}` as Hex;
const T = getAddress("0x4444444444444444444444444444444444444444");

async function deploy() {
  const { abi, bytecode } = compileRegistry() as { abi: Abi; bytecode: Hex };
  const chain = await LocalChain.start();
  const hash = await chain.send({ from: ADMIN, data: encodeDeployData({ abi, bytecode, args: [ADMIN, RECORDER] }) });
  const address = chain.receipts.get(hash)!.contractAddress!;
  const call = (from: Hex, functionName: string, args: unknown[]) => chain.send({ from: from as never, to: address, data: encodeFunctionData({ abi, functionName, args } as never) });
  return { chain, abi, call };
}

describe("GoodBuildRegistry", () => {
  it("lets only the recorder write, and emits one typed event per entry", async () => {
    const { chain, abi, call } = await deploy();
    const entries = [
      { kind: 0, builder: B, app: zeroHash, target: zeroAddress, txHash: zeroHash },
      { kind: 2, builder: B, app: A, target: T, txHash: A },
      { kind: 5, builder: zeroHash, app: A, target: T, txHash: zeroHash },
    ];
    expect(chain.receipts.get(await call(STRANGER, "recordBatch", [entries]))!.status).toBe("reverted");
    const ok = chain.receipts.get(await call(RECORDER, "recordBatch", [entries]))!;
    expect(ok.status).toBe("success");
    const names = ok.logs.map((l) => decodeEventLog({ abi, data: l.data, topics: l.topics as [Hex] }).eventName);
    expect(names).toEqual(["BuilderJoined", "ProjectDeployed", "GdollarIntegrated"]);
  });
  it("caps a batch at 100 and lets only the owner replace the recorder", async () => {
    const { chain, call } = await deploy();
    const one = { kind: 0, builder: B, app: zeroHash, target: zeroAddress, txHash: zeroHash };
    expect(chain.receipts.get(await call(RECORDER, "recordBatch", [Array(101).fill(one)]))!.status).toBe("reverted");
    expect(chain.receipts.get(await call(RECORDER, "recordBatch", [Array(100).fill(one)]))!.status).toBe("success");
    expect(chain.receipts.get(await call(STRANGER, "setRecorder", [STRANGER]))!.status).toBe("reverted");
    expect(chain.receipts.get(await call(ADMIN, "setRecorder", [STRANGER]))!.status).toBe("success");
    expect(chain.receipts.get(await call(RECORDER, "recordBatch", [[one]]))!.status).toBe("reverted");
  });
});
