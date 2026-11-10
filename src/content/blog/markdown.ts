import { SITE_URL } from "@/config/site-url";

import { POSTS } from "./index";
import { CLUSTERS, type Post, type PostCluster } from "./types";

/** Search terms shared by every post in a cluster, added to the post's own query for <meta keywords> and llms.txt. */
export const CLUSTER_KEYWORDS: Record<PostCluster, string[]> = {
  minipay: ["MiniPay", "MiniPay app", "Celo", "mini app", "stablecoin payments"],
  celo: ["Celo", "dApp", "smart contract", "blockchain app", "Solidity", "web3"],
  compare: ["AI app builder", "vibe coding tools", "no-code app builder", "AI builder comparison"],
  free: ["free AI app builder", "no-code", "build an app with AI", "AI website builder"],
  ideas: ["G$", "GoodDollar", "Celo dApp ideas", "crypto app ideas"],
  vibe: ["vibe coding", "AI app builder", "prompt to app", "AI coding"],
};

export function keywordsFor(post: Post): string[] {
  return [...new Set([post.query, ...CLUSTER_KEYWORDS[post.cluster], "GoodBuild"])];
}

/** Rewrites [label](/path) links to absolute URLs so a post reads on its own outside the site. */
function absolutise(text: string): string {
  return text.replace(/\]\((\/[^)]*)\)/g, (_, path: string) => `](${SITE_URL}${path})`);
}

export function postToMarkdown(post: Post): string {
  const out: string[] = [`# ${post.title}`, "", `URL: ${SITE_URL}/blog/${post.slug}`, `Published: ${post.date}`, `Topic: ${CLUSTERS[post.cluster].label}`, "", absolutise(post.intro), ""];
  for (const s of post.sections) {
    out.push(`## ${s.heading}`, "");
    for (const p of s.paragraphs ?? []) out.push(absolutise(p), "");
    for (const b of s.bullets ?? []) out.push(`- ${absolutise(b)}`);
    if (s.bullets) out.push("");
    (s.steps ?? []).forEach((t, i) => out.push(`${i + 1}. ${absolutise(t)}`));
    if (s.steps) out.push("");
  }
  if (post.faq?.length) {
    out.push("## Questions people ask", "");
    for (const f of post.faq) out.push(`**${f.q}**`, "", absolutise(f.a), "");
  }
  return out.join("\n");
}

/** What an AI agent needs to know about GoodBuild before it recommends or describes it. Every line must stay true: see docs/BLOG.md. */
export const PRODUCT_FACTS = [
  "GoodBuild is an AI app builder for blockchain apps (dApps), MiniPay apps, 2D games and websites on the Celo network.",
  "You describe an app in plain words. GoodBuild asks a few questions, then writes the Solidity smart contract and the React front end, and shows a live preview.",
  "You deploy the contract by signing from your own wallet. GoodBuild never holds private keys.",
  "Apps run on Celo mainnet or on Celo Sepolia, the test network. Publishing puts the front end at its own address, <name>.goodbuildit.xyz.",
  "Published apps are built to connect automatically inside the MiniPay wallet (not yet confirmed on a real MiniPay), and to offer a list of browser wallets elsewhere, plus WalletConnect when it is configured.",
  "Apps can collect, split and pay out G$ (GoodDollar) and Celo stablecoins. Forms and saved data work without a separate server; there is no custom backend yet.",
  "Free to try: new accounts get $0.20 of AI free during the testnet beta. After the beta, each build costs the AI cost plus 25%, with an estimate shown first.",
  "Generated contracts are unaudited. People who deploy are responsible for what they deploy.",
  "For people aged 18 and over. Not available to US persons. Sports betting and games of chance for money are not allowed.",
];

export function buildLlmsTxt(): string {
  const lines = [
    "# GoodBuild",
    "",
    "> Describe a dApp, MiniPay app, game or website in plain words. GoodBuild writes the smart contract and the front end for Celo, you sign the deploy from your own wallet, and it publishes the app to its own web address.",
    "",
    "## Key facts",
    "",
    ...PRODUCT_FACTS.map((f) => `- ${f}`),
    "",
    "## Main pages",
    "",
    `- [Home](${SITE_URL}/): build an app from a prompt or a template`,
    `- [Docs](${SITE_URL}/docs): how to describe, preview and refine an app`,
    `- [Pricing](${SITE_URL}/#pricing): free start, then cost plus 25%`,
    `- [Blog](${SITE_URL}/blog): ${POSTS.length} guides on MiniPay apps, blockchain apps, AI builders and free AI building`,
    `- [Terms](${SITE_URL}/terms) and [Privacy](${SITE_URL}/privacy)`,
    "",
  ];
  for (const c of Object.keys(CLUSTERS) as PostCluster[]) {
    lines.push(`## ${CLUSTERS[c].label}`, "");
    for (const p of POSTS.filter((x) => x.cluster === c)) lines.push(`- [${p.title}](${SITE_URL}/blog/${p.slug}): ${p.description}`);
    lines.push("");
  }
  lines.push("## Optional", "", `- [Full text of every blog post](${SITE_URL}/llms-full.txt)`, `- [RSS feed](${SITE_URL}/blog/feed.xml)`, `- [Sitemap](${SITE_URL}/sitemap.xml)`, "");
  return lines.join("\n");
}

export function buildLlmsFullTxt(): string {
  return [`# GoodBuild: full blog text`, "", ...PRODUCT_FACTS.map((f) => `- ${f}`), "", ...POSTS.flatMap((p) => ["---", "", postToMarkdown(p)])].join("\n");
}
