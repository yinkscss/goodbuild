import { createEVM } from "@ethereumjs/evm";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { Account, createAddressFromString, createZeroAddress, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { decodeFunctionResult, encodeFunctionData, getAddress, keccak256, toHex, type Abi, type Address, type Hex, type PublicClient } from "viem";

/**
 * A chain in a test: a real EVM running real compiled bytecode, in memory. Unlike the contract-tests
 * EVM it keeps state between transactions, so deploy, write, upgrade, read can run as separate wallet
 * calls. It answers the few client calls the deploy code makes, from what really happened. Only imported by tests.
 */
const GAS = BigInt(30_000_000);
const BLOCK = {
  header: {
    number: BigInt(1),
    coinbase: createZeroAddress(),
    timestamp: BigInt(1_750_000_000),
    difficulty: BigInt(0),
    prevRandao: new Uint8Array(32),
    gasLimit: GAS,
    baseFeePerGas: undefined,
    slotNumber: BigInt(0),
    getBlobGasPrice: () => undefined,
  },
};

export interface LocalTx {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
}

export interface LocalReceipt {
  status: "success" | "reverted";
  contractAddress: Address | null;
  blockNumber: bigint;
  transactionHash: Hex;
  revert?: Hex;
}

export class LocalChain {
  private constructor(private readonly evm: Awaited<ReturnType<typeof createEVM>>) {}
  private counter = 0;
  readonly txs = new Map<Hex, LocalTx>();
  readonly receipts = new Map<Hex, LocalReceipt>();

  static async start() {
    return new LocalChain(await createEVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Cancun }) }));
  }

  private async execute(from: Address, to: Address | null, input: Hex, value: bigint) {
    const caller = createAddressFromString(from);
    return this.evm.runCall({
      block: BLOCK as never,
      caller,
      origin: caller,
      to: to ? createAddressFromString(to) : undefined,
      data: hexToBytes(input),
      value,
      gasLimit: GAS,
      skipBalance: true,
    });
  }

  /** The EVM leaves a sender's nonce to the VM layer above it, so a transaction bumps it here. */
  private async bumpNonce(from: Address) {
    const caller = createAddressFromString(from);
    const account = (await this.evm.stateManager.getAccount(caller)) ?? new Account();
    account.nonce += BigInt(1);
    await this.evm.stateManager.putAccount(caller, account);
  }

  /** A mined transaction. A revert still produces a receipt, as on a real chain. */
  async send(tx: { from: Address; to?: Address | null; data: Hex; value?: bigint }): Promise<Hex> {
    const to = tx.to ?? null;
    const result = await this.execute(tx.from, to, tx.data, tx.value ?? BigInt(0));
    await this.bumpNonce(tx.from);
    const hash = keccak256(toHex(`tx-${++this.counter}`));
    const failed = Boolean(result.execResult.exceptionError);
    this.txs.set(hash, { hash, from: getAddress(tx.from), to: to ? getAddress(to) : null, input: tx.data });
    this.receipts.set(hash, {
      status: failed ? "reverted" : "success",
      contractAddress: !failed && !to && result.createdAddress ? getAddress(result.createdAddress.toString()) : null,
      blockNumber: BigInt(this.counter),
      transactionHash: hash,
      revert: failed ? bytesToHex(result.execResult.returnValue) : undefined,
    });
    return hash;
  }

  /** Runs a call or creation without keeping it, as eth_call and eth_estimateGas do. */
  async dryRun(tx: { from: Address; to?: Address | null; data: Hex }): Promise<{ ok: boolean; returned: Hex; gas: bigint }> {
    this.evm.stateManager.checkpoint();
    try {
      const result = await this.execute(tx.from, tx.to ?? null, tx.data, BigInt(0));
      return { ok: !result.execResult.exceptionError, returned: bytesToHex(result.execResult.returnValue), gas: result.execResult.executionGasUsed };
    } finally {
      await this.evm.stateManager.revert();
    }
  }

  async read<T = unknown>(address: Address, abi: Abi, functionName: string, args: unknown[] = []): Promise<T> {
    const data = encodeFunctionData({ abi, functionName, args });
    const out = await this.dryRun({ from: "0x00000000000000000000000000000000000000aa", to: address, data });
    if (!out.ok) throw new Error(`${functionName} reverted: ${out.returned}`);
    return decodeFunctionResult({ abi, functionName, data: out.returned, args }) as T;
  }

  async slot(address: Address, slot: Hex): Promise<Hex> {
    const raw = await this.evm.stateManager.getStorage(createAddressFromString(address), hexToBytes(slot));
    return `0x${bytesToHex(raw).slice(2).padStart(64, "0")}`;
  }

  async balance(address: Address): Promise<bigint> {
    return (await this.evm.stateManager.getAccount(createAddressFromString(address)))?.balance ?? BigInt(0);
  }

  async code(address: Address): Promise<Hex> {
    return bytesToHex(await this.evm.stateManager.getCode(createAddressFromString(address)));
  }

  /** What the deploy code uses from viem's PublicClient. */
  client(): PublicClient {
    return {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        const receipt = this.receipts.get(hash);
        if (!receipt) throw new Error("unknown transaction");
        return receipt;
      },
      getTransaction: async ({ hash }: { hash: Hex }) => {
        const tx = this.txs.get(hash);
        if (!tx) throw new Error("unknown transaction");
        return tx;
      },
      getStorageAt: ({ address, slot }: { address: Address; slot: Hex }) => this.slot(address, slot),
      readContract: ({ address, abi, functionName, args }: { address: Address; abi: Abi; functionName: string; args?: unknown[] }) => this.read(address, abi, functionName, args),
    } as unknown as PublicClient;
  }
}
