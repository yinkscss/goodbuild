/**
 * Front-end guides the agent loads on demand (AI_AGENT.md §6, P14).
 *
 * The system prompt lists each guide's name and when it applies; the model picks the
 * ones it needs in set_plan (`guides`) or with read_guide. Nothing here classifies the
 * request: the model decides, the guide only teaches. Keep each guide short, concrete
 * and true for the starter template in template.ts.
 */

export interface Guide {
  name: string;
  /** One line for the system prompt: when to load it. */
  when: string;
  body: string;
}

export const GUIDES: Guide[] = [
  {
    name: "pages-and-routing",
    when: "the app needs more than one page or screen (landing, about, signup, dashboard, detail pages), or the user asks to add a page",
    body: `Pages and routing (react-router-dom v6, already in package.json for new projects; if list_files or package.json shows it missing, call add_dependency("react-router-dom") first).
- Use HashRouter (the preview and static hosting have no server routes). src/App.tsx holds only the router and the route table:
    <HashRouter><Routes><Route element={<Layout />}><Route index element={<Home />} /><Route path="about" element={<About />} /><Route path="*" element={<NotFound />} /></Route></Routes></HashRouter>
- One file per page in src/pages/ (Home.tsx, About.tsx, Signup.tsx, ...), default export, named after the page. Shared pieces go in src/components/.
- src/components/Layout.tsx: the top bar (app mark + name linking to "/", nav links, ConnectButton when the app uses a wallet), <Outlet />, and a small footer. Every page renders inside it, so the header is written once.
- Nav: NavLink with an active style (text-foreground font-medium vs text-muted-foreground). On mobile, collapse links into a menu button (lucide Menu / X) that toggles a stacked list; close it on navigation.
- When you add a page, do all three in one turn: create the page, add its Route, add its nav link. Keep the existing pages working.
- Links between pages: <Link to="/signup"> (never <a href="/signup">, which reloads and breaks HashRouter). Scroll to top on route change with a tiny effect in Layout (useLocation + window.scrollTo(0, 0)).
- If the app was a single page, move its content into src/pages/Home.tsx (or a name that fits, e.g. Jar.tsx) rather than rewriting it.
- A NotFound page with a link home. Set document.title per page in a useEffect (e.g. "About · Lagos Brew").`,
  },
  {
    name: "landing-page",
    when: "a landing page, home page, marketing page, product or event page, portfolio, or any website that has to sell or explain something",
    body: `Landing pages: one job (get the visitor to take the main action) and a clear story.
- Order that works: hero, proof or how-it-works, features or offer, details people ask about (FAQ, pricing, schedule, location), a final call to action, footer. Use only the sections the request needs; a small page is fine.
- Hero: a specific headline about the visitor's outcome (not the product name alone), one supporting sentence, one primary button with a verb ("Start saving", "Book a table", "Connect wallet") and at most one secondary link. Visual weight on the left text or centred; on mobile everything stacks, button full width.
- How it works: 3 numbered steps with a lucide icon each. Features: 3 to 6 cards in a grid (sm:grid-cols-2 lg:grid-cols-3), each a short title and one sentence.
- Rhythm: sections py-16 sm:py-24, content max-w-5xl or max-w-6xl mx-auto px-4 sm:px-6. Alternate section backgrounds with tokens (bg-background then bg-muted) instead of borders everywhere. One eyebrow label per section at most (text-xs uppercase tracking-wider text-accent).
- Visuals without image files: a soft gradient or blurred accent shape behind the hero (bg-accent/10, blur-3xl, absolute, pointer-events-none), icon tiles, a mock card of the product UI built from components. No external image URLs unless the user gives one.
- Copy: write from the request. Never invent testimonials, customer names, logos, prices, addresses, opening hours or stats and present them as real. If a section needs facts you don't have, write clearly marked sample copy ("Your opening hours here") and mention it in your reply.
- If the site belongs to a dApp, the landing page explains it in plain words and its button goes to the app page (Link to "/app") or connects the wallet.
- A single h1 on the page; h2 per section. Buttons and links have visible focus styles (the starter Button does).`,
  },
  {
    name: "forms-and-signup",
    when: "signup, login, join, waitlist, contact, booking or any form that collects input",
    body: `Forms and signup. GoodBuild apps have no backend or database yet, so:
- "Sign up" / "join" / "log in" in a dApp means connecting a wallet: a Signup page that explains what joining gives, a big ConnectButton (or useWallet().connect), and a success state that shows the connected shortAddress and sends them on (Link to the app page). Never build passwords or a fake account system.
- If the app needs a member list, a small contract can record it (e.g. join(string name) emitting Joined(address, name), with a view to read members), and the page calls it after connecting.
- Email, waitlist, contact or booking forms: build the form properly but do not pretend it was sent. Either keep the submit button with an honest note ("Sign-ups open soon") or, if the user wants it working now, save to an on-chain registry as above. Say in your reply that storing emails needs a backend GoodBuild doesn't offer yet. Never send form data to third-party URLs.
- Form craft: Label + Input pairs (htmlFor/id), helpful placeholder, required fields marked, inline validation on blur and submit (text-danger text-xs under the field), the submit button disabled while pending with a "Joining…" label, and a Notice for success or failure. type="email", inputMode="decimal" for amounts, autoComplete where it helps.
- Keep forms short: ask only for what the app uses. One column on mobile, max-w-md.`,
  },
  {
    name: "design-tokens",
    when: "the user asks to change the look (colours, fonts, dark mode, 'make it greener', a brand), or you are styling a new app or page",
    body: `Design tokens: the look lives in the @theme block of public/index.html, not in component classes.
- Use semantic token classes only: bg-background, bg-muted, bg-card, text-foreground, text-muted-foreground, border-border, bg-primary text-primary-foreground, bg-accent text-accent-foreground, text-success / text-warning / text-danger, ring-ring. Opacity modifiers are fine (bg-accent/10).
- Don't use raw palette classes (bg-white, text-gray-500, bg-blue-600, text-black). If you need a colour that has no token, add a token to @theme first (e.g. --color-highlight: #f5b301;) and use bg-highlight.
- Before using a token, check that public/index.html defines it (older projects may lack --color-card, --color-accent-foreground, --color-ring or --font-display); add any that are missing.
- "Make it greener" or a brand colour: change --color-accent (and --color-primary if the brand is dark or bold), keep contrast at least 4.5:1 for text on the colour, update --color-accent-foreground to match.
- Fonts: you may add one Google Fonts <link> in the <head> of public/index.html and set --font-sans (body) and --font-display (headings, used as font-display). Keep it to one or two families.
- Variants over one-off classes: if a style repeats (a hero button, a pill), add a variant to src/components/ui/button.tsx (cva) or a small component, instead of copying long class strings.
- Dark mode only if asked: add a .dark block that overrides the same tokens and a toggle that sets document.documentElement.classList.
- Radius and shadow: keep one radius (rounded-lg) and soft shadows (shadow-sm) across the app.`,
  },
  {
    name: "content-pages",
    when: "about, FAQ, team, terms, help, docs or other mostly-text pages",
    body: `Content pages (about, FAQ, help, terms).
- Start from what the app actually does (read the contract and the main page). An About page says who it's for, what problem it solves, how it works on Celo with G$ if relevant, and what's next. Plain words for Web3 newcomers; explain "wallet", "G$" and "transaction" in one line each where they first appear.
- Never invent people, team members, partners, addresses or legal terms. If the user wants a team or contact section, leave clearly marked placeholders and say so in your reply.
- Layout: max-w-3xl prose column, h1 + one-line intro, then h2 sections with short paragraphs (text-muted-foreground leading-relaxed) and lists. FAQ as a list of <details><summary> items styled as cards, 4 to 8 real questions about using this app.
- End with a call to action back to the main page (Link).`,
  },
  {
    name: "dashboard-and-data",
    when: "stats, balances, leaderboards, history, lists or tables of on-chain data",
    body: `Dashboards and on-chain data.
- Read through the contract's view functions with useRead (from src/lib/hooks.ts); refresh after each write. Prefer bounded views (recent(limit), page(offset, limit)) over unbounded arrays.
- Stats row: 2 to 4 cards (grid-cols-2 sm:grid-cols-4), label text-xs text-muted-foreground, value text-2xl font-semibold tabular-nums, formatted with formatAmount; a Skeleton while loading and "–" when the contract isn't deployed.
- Lists and leaderboards: rows with shortAddress, amount right-aligned tabular-nums, relative time if available; highlight the connected account's row (bg-accent/5). Empty state with a short sentence and the main action.
- Tables only on wide screens; on mobile, render each row as a stacked card.
- Never show made-up numbers as real data. Sample values are fine only in the deploy-to-go-live state if clearly labelled as an example.`,
  },
  {
    name: "tokens",
    when: "the user wants their own coin or token (ERC-20), a supply, minting, burning or a token page",
    body: `Your own ERC-20 token.
- contracts/<Symbol>Token.sol (e.g. RTXToken.sol): contract RTXToken is ERC20 (plus ERC20Burnable if burning is asked) with constructor() ERC20("RTX", "RTX") { _mint(msg.sender, 50_000_000 * 10 ** decimals()); }. A fixed supply minted once to the deployer is the default: no mint function, no owner, nothing anyone can change later. That is what "supply of N" means.
- Only add a capped owner mint (ERC20Capped + Ownable) if the user asks for more tokens later; say in your reply who can mint.
- No transfer taxes, blacklists, pause switches or owner-only transfer hooks unless the user explicitly asks; those are how scam tokens trap holders.
- The deployer holds the whole supply after deploy. Say so in your reply, and if the app has a pool or sale, explain that the owner must add RTX (and G$) to it before anyone can buy.
- Front end: a token card with name, symbol, total supply (formatAmount with decimals()), the connected wallet's balance, and a Send form (address + amount, validated with isAddress from viem). Add the token to the wallet with wallet_watchAsset (EIP-747) via a small "Add RTX to wallet" button once deployed.`,
  },
  {
    name: "swaps-and-markets",
    when: "buy, sell, swap, exchange, trade, liquidity, pool, price, market or DEX features",
    body: `Buying, selling and swapping tokens on Celo.
- GoodBuild can't call external DEXes yet (no verified router addresses in the template), so build your own small pool: contracts/<A><B>Pool.sol, a constant-product market (x * y = k) between two ERC-20s, e.g. G$ and RTX. "Buy RTX" = swap G$ for RTX, "Sell RTX" = swap RTX for G$, "Swap" = either direction. One pool covers all three.
- Constructor(IERC20 tokenA_, IERC20 tokenB_), both immutable, distinct and non-zero. Keep reserves in storage (reserveA, reserveB) and update them from actual balances after each transfer.
- Liquidity: addLiquidity(amountA, amountB, minShares) mints internal shares (first deposit: Math.sqrt(amountA * amountB) from @openzeppelin/contracts/utils/math/Math.sol; later: min of the proportional amounts) and removeLiquidity(shares, minA, minB). Anyone may add liquidity; nobody, including the owner, can withdraw other people's tokens.
- swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, uint256 deadline): check deadline, tokenIn is A or B, amountIn > 0; pull with safeTransferFrom; amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee) with amountInWithFee = amountIn * 997 (0.3% fee to liquidity providers); revert SlippageTooHigh() if amountOut < minAmountOut; send with safeTransfer; nonReentrant; emit Swapped(user, tokenIn, amountIn, amountOut).
- Views the UI needs: getAmountOut(tokenIn, amountIn), getReserves(), sharesOf(user), totalShares, and spot price.
- Custom errors, SafeERC20, nonReentrant on every function that moves tokens, checks-effects-interactions. No owner functions that touch reserves.
- Keep the pool under 24 KB of bytecode: no on-chain charts or history arrays; the UI reads Swapped events with publicClient.getContractEvents for recent trades.
- Front end: a swap card with a token selector (G$ / RTX) for "You pay" and "You get", a flip button, the quote from getAmountOut (debounced), price impact (amountOut vs spot price), a slippage setting (default 1%, minAmountOut = quote * (1 - slippage)), a deadline of now + 10 minutes, balances under each field, then Approve (only if allowance < amount) and Swap buttons with useTx. Tabs or segmented control for Buy / Sell / Swap if the user names them, sharing the same card. A liquidity panel (add/remove) and an empty-pool state: "No liquidity yet. The owner adds RTX and G$ to open trading."
- Never promise prices or returns; label price impact and say pool prices move with every trade.`,
  },
  {
    name: "multi-contract",
    when: "the app needs two or more contracts that work together (a token plus a pool, sale, staking or vault)",
    body: `Several contracts in one app.
- One contract per file in contracts/, each small and focused (a token, a pool, a sale). Prefer two simple contracts to one big one; each must stay under 24 KB of bytecode.
- A contract that needs another one takes its address as a constructor argument (IERC20 rtx_, not a hard-coded address and not created inside with new). Name constructor arguments clearly (rtxToken_, gd_) because the user is asked for them at deploy.
- Say the deploy order in your reply: e.g. "Deploy RTXToken first, then RTXPool with the G$ address and the RTXToken address." (GoodBuild's deploy flow handles G$ and will fill other contracts' addresses in a later update.)
- Front end: import each contract's Abi and Address from ./contracts and index each map with chain.id. The app is live only when every contract it uses is deployed: compute const ready = Boolean(tokenAddress && poolAddress) and show the deploy Notice listing what's missing.
- Share token metadata reads (symbol, decimals) in a small hook (src/lib/useToken.ts) rather than repeating them in every component.`,
  },
  {
    name: "contract-tests",
    when: "any contract that holds, moves, sells or swaps tokens (write its test file)",
    body: `Contract tests: GoodBuild runs contracts/test/<Name>.t.sol in a local EVM after every compile; failures come back to you to fix like compile errors. Nothing is deployed.
- File contracts/test/<Name>.t.sol, one contract named <Name>Test that extends Test:
    import {Test, Actor} from "@goodbuild/Test.sol";
    import {MockGoodDollar} from "@goodbuild/MockGoodDollar.sol";   // G$ stand-in: ERC-20 + transferAndCall + public mint(to, amount)
    import {RTXPool} from "../RTXPool.sol";
- setUp() deploys fresh contracts (new MockGoodDollar(), new RTXToken(), new RTXPool(gd, rtx)) and funds users. The test contract is the deployer, so it holds any supply minted to msg.sender.
- Every function named test...() with no parameters is one test, run on a fresh deploy after setUp(). A test passes if it doesn't revert.
- Users: Actor alice = newActor(); then act as alice with alice.exec(address(target), abi.encodeCall(target.fn, (args))). Use actors for every user flow (approve then buy, sell, add liquidity), because a contract calling itself hides allowance bugs.
- Assertions: assertTrue(cond, "msg"), assertEq(a, b, "msg") (uint or address), assertGt, assertGe; expectRevert(alice, address(target), abi.encodeCall(...), "msg") for calls that must fail (slippage, unauthorised, zero amount).
- Cover the main flows the UI offers, one test each: the happy path (buy, sell, swap, tip, withdraw), the one-step G$ path (alice.exec(address(gd), abi.encodeCall(gd.transferAndCall, (address(pool), amount, data)))), and the important guards (slippage, owner-only, empty pool). 3 to 6 short tests; keep the file under 150 lines.
- No cheatcodes exist (no vm.prank, no warp); block.timestamp is 0, so deadlines like block.timestamp + 600 work.`,
  },
  {
    name: "cross-chain",
    when: "cross-chain, bridge, multichain, other networks, or moving tokens between chains",
    body: `Cross-chain requests.
- GoodBuild apps run on Celo (Celo Sepolia for now). Real bridging to other chains needs a bridge protocol and relayers that GoodBuild doesn't integrate, and hand-written bridges are a major source of hacks. Don't write a bridge contract, a "lock and mint" contract, or anything that claims to move tokens to another chain.
- Usually the user means swapping between Celo tokens (G$ to cUSD, G$ to their own coin). Build that on Celo with the swaps-and-markets guide (an in-app pool), and say in one sentence that true cross-chain transfers aren't supported yet.
- If they need to reach a coin that has no pool in the app, say that swapping it needs an external DEX or bridge that the app doesn't connect to yet, and leave a clear "Coming later" state in the UI rather than a fake button.`,
  },
];

const BY_NAME = new Map(GUIDES.map((g) => [g.name, g]));

export function guideNames(): string[] {
  return GUIDES.map((g) => g.name);
}

/** The bodies of the named guides, for a tool result. Unknown names are listed so the model can correct them. */
export function loadGuides(names: unknown): { text: string; loaded: string[] } {
  const wanted = (Array.isArray(names) ? names : [names]).map((n) => String(n ?? "").trim()).filter(Boolean);
  const loaded: string[] = [];
  const unknown: string[] = [];
  const parts: string[] = [];
  for (const n of [...new Set(wanted)]) {
    const g = BY_NAME.get(n);
    if (!g) unknown.push(n);
    else {
      loaded.push(g.name);
      parts.push(`<guide name="${g.name}">\n${g.body}\n</guide>`);
    }
  }
  if (unknown.length) parts.push(`Unknown guide name(s): ${unknown.join(", ")}. Available: ${guideNames().join(", ")}.`);
  return { text: parts.join("\n\n"), loaded };
}

/** The guide list for the system prompt. */
export function guideCatalog(): string {
  return GUIDES.map((g) => `- ${g.name}: ${g.when}`).join("\n");
}
