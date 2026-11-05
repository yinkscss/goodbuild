import type { Hex } from "viem";

/**
 * Opcodes newer than Paris. Solidity 0.8.28 emits them for evmVersion cancun (D17). Celo may not
 * accept all of them, and geth only fails at the moment an undefined opcode runs, so a contract
 * can deploy fine and then revert on its first call. We scan the runtime code for them and ask
 * the target chain whether each one exists before the user pays for anything.
 */
export const NEW_OPCODES: Record<string, { byte: number; name: string; probe: Hex }> = {
  PUSH0: { byte: 0x5f, name: "PUSH0", probe: "0x5f00" },
  MCOPY: { byte: 0x5e, name: "MCOPY", probe: "0x6000600060005e00" },
  TLOAD: { byte: 0x5c, name: "TLOAD", probe: "0x60005c5000" },
  TSTORE: { byte: 0x5d, name: "TSTORE", probe: "0x600060005d00" },
  BLOBHASH: { byte: 0x49, name: "BLOBHASH", probe: "0x6000495000" },
  BLOBBASEFEE: { byte: 0x4a, name: "BLOBBASEFEE", probe: "0x4a5000" },
};

/** Opcode names from `code` that need a post-Paris EVM, ignoring PUSH data and the metadata trailer. */
export function newOpcodesUsed(code: Hex): string[] {
  const hex = code.startsWith("0x") ? code.slice(2) : code;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // Solidity appends CBOR metadata; its last two bytes give its length.
  let end = bytes.length;
  if (end > 2) {
    const metadataLength = (bytes[end - 2] << 8) | bytes[end - 1];
    if (metadataLength > 0 && metadataLength + 2 < end) end -= metadataLength + 2;
  }
  const byOpcode = new Map(Object.values(NEW_OPCODES).map((o) => [o.byte, o.name]));
  const found = new Set<string>();
  for (let i = 0; i < end; i++) {
    const op = bytes[i];
    if (op >= 0x60 && op <= 0x7f) {
      i += op - 0x5f; // PUSH1..PUSH32 carry 1..32 bytes of data
      continue;
    }
    const name = byOpcode.get(op);
    if (name) found.add(name);
  }
  return [...found];
}
