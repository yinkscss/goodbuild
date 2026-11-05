import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { runSolc } from "@/server/agent/checks";

export const maxDuration = 60;

/** Development only: TestGoodDollar's ABI and bytecode for /dev/test-gd (D23, D24). */
export async function POST() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const source = readFileSync(path.join(process.cwd(), "scripts/solidity/goodbuild/TestGoodDollar.sol"), "utf8");
  const { output } = await runSolc({ "TestGoodDollar.sol": source }, 60_000, { evmVersion: "cancun", legacyOpenZeppelin: false });
  const errors = (output.errors ?? []).filter((e) => e.severity === "error").map((e) => e.message);
  const artifact = output.contracts?.["TestGoodDollar.sol"]?.TestGoodDollar;
  if (errors.length || !artifact?.evm?.bytecode?.object) return NextResponse.json({ error: "compile_failed", details: errors }, { status: 500 });
  return NextResponse.json({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` });
}
