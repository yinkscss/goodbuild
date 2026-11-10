# Blog and search visibility

Written 10 Nov 2026 (D74). 50 posts live at `/blog`, written to rank for what builders search and to be easy for AI assistants to read and cite.

## Where things are
- Posts: `src/content/blog/{minipay,celo,compare,free,ideas,vibe}.ts`, typed in `types.ts`. Plain data, no MDX. Text may hold `[label](/path)` links.
- Pages: `src/app/blog/page.tsx` (index), `src/app/blog/[slug]/page.tsx` (post, Article + FAQPage + BreadcrumbList JSON-LD, canonical URL, keywords).
- Discovery: `src/app/sitemap.ts`, `src/app/robots.ts` (names the AI crawlers), `/llms.txt`, `/llms-full.txt` (all posts as markdown, built by `src/content/blog/markdown.ts`), `/blog/feed.xml` (RSS). Landing page carries Organization, WebSite and SoftwareApplication JSON-LD.
- Tests: `src/content/blog/blog.test.ts` (50 posts, unique slugs and target queries, title ≤ 58 and description 80–160 characters, at least 230 words, links resolve, roundups name GoodBuild and say "November 2026", banned terms, the target query appears in the title and opening, llms files).

## Add a post
Add an object to the right cluster file with a **new** target `query`, then run `pnpm vitest run src/content/blog`. Update the count in the test. Date it the day it is written; never back-date.

## Fact sheet every post must stay inside (re-check before editing)
- Free means **$0.20 of AI for each new account during the testnet beta**, then AI cost + 25% with an estimate first. Never "free forever". Credits are bought in G$ packs; verified GoodDollar wallets get 10% extra (D52 area).
- Mainnet is open (D51). Sepolia is the test network. Deploys are signed in the user's wallet; GoodBuild never holds keys.
- Generated contracts are **unaudited**. Say so in any safety post.
- Published apps are **built** to auto-connect in MiniPay. **UNVERIFIED** on a real MiniPay (D36). Don't write "tested in MiniPay".
- No separate server behind apps for now. Forms and saved data work (D31, D34).
- 18+, no US persons. No sports betting or games of chance for money (D72). No US-targeted keywords.
- Don't name model vendors for GoodBuild's own AI.
- Roundups: describe competitors by stable traits only. No competitor prices or free-tier numbers. Put GoodBuild in every list, positioned by niche (Celo, MiniPay, web3), never as #1 for general web apps.

## Keyword map
50 posts, one target query each (the `query` field is the source of truth).

| Cluster | Posts | Examples of target queries |
|---|---|---|
| MiniPay | 8 | what is a minipay app; build a minipay app without coding; minipay mini app ideas; test minipay app developer mode; get app listed on minipay discover page |
| Blockchain / Celo | 12 | how to build a dapp on celo; build a dapp without coding; ai smart contract generator; deploy smart contract celo sepolia; is ai generated smart contract safe; create erc20 token without coding |
| AI builders compared | 10 | best ai app builders 2026; best ai dapp builder for web3; lovable alternatives; bolt.new alternatives; replit alternatives; base44 alternatives |
| Free and no-code | 6 | free ai app builder; free ai website builder; no code vs vibe coding; how much does an ai app builder cost |
| G$ app ideas | 10 | what is g$ gooddollar token; how to build a savings circle app; build a crowdfunding dapp; build an escrow app smart contract |
| Vibe coding | 4 | what is vibe coding; ai app builder prompt tips; vibe coding a blockchain app risks |

**UNVERIFIED:** search volumes and rankings. Nothing here was measured; the queries come from the topics the owner named and a handful of live searches on 10 Nov 2026. After the sitemap is submitted, read Search Console after two to four weeks and merge or rewrite posts that get no impressions.

## Owner to do
1. Submit `https://goodbuildit.xyz/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
2. Confirm Cloudflare isn't blocking AI crawlers (its "AI Scrapers and Crawlers" and "Block AI bots" settings override `robots.txt`).
3. Have someone read the posts that give advice on money (escrow, crowdfunding, savings circle, skill game) before relying on them, and add a lawyer's view on the prize-game and fundraising notes.
4. Set `NEXT_PUBLIC_CONTACT_EMAIL` so the legal pages have an address.
