import { connection } from "next/server";

import { explorerAddressUrl, explorerTxUrl } from "@/lib/deploy/explorer";
import { getPublicStats } from "@/server/stats/cached";

/** The same numbers as /stats, as JSON, with every mainnet contract and its Celoscan links so anyone can check them (D90). */
export async function GET() {
  await connection();
  try {
    const stats = await getPublicStats();
    const chainId = stats.mainnet.chainId;
    const body = {
      ...stats,
      network: "Celo mainnet",
      contracts: stats.contracts.map((c) => ({ ...c, explorer: explorerAddressUrl(chainId, c.address), transaction: explorerTxUrl(chainId, c.txHash) })),
      notes: [
        "Counts only. No wallets, emails or amounts are published.",
        "On-chain figures are Celo mainnet only. Transactions = contract deploys (2 for an upgradeable contract) + upgrades (2 each) + credit purchases.",
        "Contracts from projects their owners deleted are not counted, although they stay on-chain.",
        "Refreshed at most every 10 minutes.",
      ],
    };
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    console.error("public stats unavailable", error);
    return Response.json({ error: "Stats are unavailable right now. Try again in a minute." }, { status: 503 });
  }
}
