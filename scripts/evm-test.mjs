// Run generated contract tests in a local in-memory EVM (P16), in a child process so a
// looping test can't block the web server. Reads {tests, abis} JSON on stdin and writes
// {results} JSON. Each test contract's `test*()` functions run in a fresh EVM: deploy the
// test contract, call setUp() if present, then the test. A test passes when it doesn't revert.
import { createEVM } from "@ethereumjs/evm";
import { Common, Hardfork, Mainnet } from "@ethereumjs/common";
import { createAddressFromString, hexToBytes, bytesToHex } from "@ethereumjs/util";
import { decodeErrorResult, encodeFunctionData } from "viem";

const GAS = 30_000_000n;
const CALLER = createAddressFromString("0x1000000000000000000000000000000000000001");

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  main(JSON.parse(raw)).then(
    (out) => process.stdout.write(JSON.stringify(out)),
    (e) => process.stdout.write(JSON.stringify({ fatal: String(e?.stack ?? e) })),
  );
});

async function freshEvm() {
  // Cancun: solc targets it and OpenZeppelin 5 uses MCOPY.
  return createEVM({ common: new Common({ chain: Mainnet, hardfork: Hardfork.Cancun }) });
}

/** Every custom error in every compiled ABI, plus the test helpers', for readable reverts. */
function errorAbi(abis) {
  const seen = new Set();
  const out = [];
  for (const abi of abis) {
    for (const item of abi ?? []) {
      if (item.type !== "error") continue;
      const key = `${item.name}(${(item.inputs ?? []).map((i) => i.type).join(",")})`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function describeRevert(bytes, errors) {
  const hex = bytesToHex(bytes);
  if (hex === "0x") return "reverted with no reason (out of gas, a failed require without message, or an invalid opcode)";
  try {
    const d = decodeErrorResult({ abi: errors, data: hex });
    const args = (d.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
    return `${d.errorName}(${args.join(", ")})`;
  } catch {
    return `reverted with unknown error data ${hex.slice(0, 74)}`;
  }
}

async function call(evm, to, data) {
  return evm.runCall({ caller: CALLER, origin: CALLER, to, data: hexToBytes(data), gasLimit: GAS, skipBalance: true });
}

async function main({ tests, abis }) {
  const errors = errorAbi(abis);
  const results = [];
  for (const t of tests) {
    const fns = (t.abi ?? []).filter((i) => i.type === "function" && /^test/.test(i.name) && (i.inputs ?? []).length === 0);
    const hasSetUp = (t.abi ?? []).some((i) => i.type === "function" && i.name === "setUp" && (i.inputs ?? []).length === 0);
    if (!fns.length) {
      results.push({ contract: t.name, file: t.file, test: "(none)", ok: false, reason: "no test functions: name them test...() with no parameters" });
      continue;
    }
    for (const fn of fns) {
      const evm = await freshEvm();
      const created = await evm.runCall({ caller: CALLER, origin: CALLER, data: hexToBytes(`0x${t.bytecode}`), gasLimit: GAS, skipBalance: true });
      if (created.execResult.exceptionError || !created.createdAddress) {
        results.push({ contract: t.name, file: t.file, test: fn.name, ok: false, reason: `deploying the test contract failed: ${describeRevert(created.execResult.returnValue, errors)}` });
        continue;
      }
      const at = created.createdAddress;
      if (hasSetUp) {
        const s = await call(evm, at, encodeFunctionData({ abi: t.abi, functionName: "setUp" }));
        if (s.execResult.exceptionError) {
          results.push({ contract: t.name, file: t.file, test: fn.name, ok: false, reason: `setUp() failed: ${describeRevert(s.execResult.returnValue, errors)}` });
          continue;
        }
      }
      const r = await call(evm, at, encodeFunctionData({ abi: t.abi, functionName: fn.name }));
      const ok = !r.execResult.exceptionError;
      results.push({
        contract: t.name,
        file: t.file,
        test: fn.name,
        ok,
        gasUsed: Number(r.execResult.executionGasUsed),
        ...(ok ? {} : { reason: describeRevert(r.execResult.returnValue, errors) }),
      });
    }
  }
  return { results };
}
