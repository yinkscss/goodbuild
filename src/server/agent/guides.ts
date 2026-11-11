/**
 * Front-end guides the agent loads on demand (AI_AGENT.md §6, P14).
 *
 * The system prompt lists each guide's name and when it applies; the model picks the
 * ones it needs in set_plan (`guides`) or with read_guide. Nothing here classifies the
 * request: the model decides, the guide only teaches. Keep each guide short, concrete
 * and true for the starter template in template.ts.
 */

import { KITS, kitGuideName } from "./kits/registry";
import { UI_GUIDE } from "./ui-primitives";

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
- Nav: NavLink with an active style (text-foreground font-medium vs text-muted-foreground). The link to "/" needs the end prop (<NavLink to="/" end>), or Home looks active on every page. Responsive: links inline from md: up (hidden md:flex); below md, a menu button (lucide Menu, aria-label="Menu") opens a Sheet from src/components/ui/sheet.tsx (load the ui-components guide) holding the links stacked (each py-3) and the ConnectButton at the bottom; keep its open state in the Layout and close it on navigation (useEffect on location.pathname). The sheet handles Escape, focus and the tap outside itself. Sticky top bar: sticky top-0 z-40 bg-background/80 backdrop-blur border-b border-border. Logo (uploaded or icon) + app name on the left.
- dApps with several pages: Home (what it is, live stats, button into the app), the app page(s) where the contract actions live (e.g. /app or /jar), plus About or FAQ. The ConnectButton sits in the Layout's top bar; a page that needs the account calls useWallet() itself; contract pages each own their reads with useRead.
- When you add a page, do all three in one turn: create the page, add its Route, add its nav link. Keep the existing pages working.
- Links between pages: <Link to="/signup"> (never <a href="/signup">, which reloads and breaks HashRouter). Scroll to top on route change with a tiny effect in Layout (useLocation + window.scrollTo(0, 0)).
- If the app was a single page, move its content into src/pages/Home.tsx (or a name that fits, e.g. Jar.tsx) rather than rewriting it.
- A NotFound page with a link home. Set document.title per page in a useEffect (e.g. "About · Lagos Brew").`,
  },
  {
    name: "landing-page",
    when: "a landing page, home page, marketing page, product or event page, portfolio, or any website that has to sell or explain something",
    body: `Landing pages: one job (get the visitor to take the main action) and a clear story.
- Pick ONE archetype that fits the request, and say which in set_plan:
  1. Product launch: split hero (copy left, product mock or image right), logo/proof strip, 3 feature cards, how-it-works steps, CTA band.
  2. Event or community: centred hero with date/place chips and a countdown or "Join" button, schedule list, speakers/organisers placeholders, location card, FAQ, CTA.
  3. Editorial or story (cause, portfolio, about a person or club): big display headline, long-form sections alternating text and image, pull quote, CTA.
  4. Bento showcase: hero plus a grid of mixed-size cards (md:grid-cols-3, one card md:col-span-2) each holding one idea: a stat, a feature, an image.
  5. Shop or menu: hero with offer, category tabs or chips, item card grid with price, "how to pay in G$" steps, contact/location.
  6. dApp front door: hero that says what the app does in plain words, a live stat row from the contract (or labelled placeholders before deploy), 3 steps, button into the app page.
- Section library (compose; each is a <section id="..."> with an h2): hero, logo-strip, features (cards), how-it-works (numbered steps), stats (big numbers), showcase (image + text, alternate sides with md:flex-row-reverse), pricing/offer, schedule/timeline, team (placeholders), testimonials ONLY if the user gave quotes, FAQ (the Accordion from src/components/ui/accordion.tsx), cta-band (bg-primary text-primary-foreground rounded-2xl p-8 sm:p-12), footer (links, small print).
- Hero: a specific headline about the visitor's outcome (not the product name alone), one supporting sentence, one primary button with a verb ("Start saving", "Book a table", "Connect wallet") and at most one secondary link. Headline in font-display, text-4xl sm:text-5xl lg:text-6xl, tracking-tight, max ~12 words. On mobile everything stacks, button full width.
- How it works: 3 numbered steps with a lucide icon each. Features: 3 to 6 cards in a grid (sm:grid-cols-2 lg:grid-cols-3), each a short title and one sentence.
- Rhythm: sections py-16 sm:py-24, content max-w-5xl or max-w-6xl mx-auto px-4 sm:px-6. Alternate section backgrounds with tokens (bg-background then bg-muted) instead of borders everywhere. One eyebrow label per section at most (text-xs uppercase tracking-wider text-accent).
- Imagery: if the user uploaded images (see Uploaded assets), use them: hero image in a rounded-2xl frame with object-cover and fixed aspect (aspect-[4/3] or aspect-video), showcase sections, avatars. Otherwise: a soft gradient or blurred accent shape behind the hero (bg-accent/10, blur-3xl, absolute, pointer-events-none), icon tiles, a mock card of the product UI built from components. Never external image URLs or invented file paths.
- Big sites: one component per section in src/components/sections/ (Hero.tsx, Features.tsx, Faq.tsx), composed by the page, so later edits find the right file.
- Copy: write from the request. Never invent testimonials, customer names, logos, prices, addresses, opening hours or stats and present them as real. If a section needs facts you don't have, write clearly marked sample copy ("Your opening hours here") and mention it in your reply.
- If the site belongs to a dApp, the landing page explains it in plain words and its button goes to the app page (Link to "/app") or connects the wallet.
- A single h1 on the page; h2 per section. Buttons and links have visible focus styles (the starter Button does).
- Look and movement: load the visual-design guide and choose a direction before writing. Turn on the motion kit (add_kit("motion")) for the hero headline, scroll reveals and count-up stats, and follow its guide: one hero moment, the same reveal down the page, forms stay still.`,
  },
  {
    name: "forms-and-signup",
    when: "signup, login, join, waitlist, contact, booking or any form that collects input",
    body: `Forms and signup.
- A form people send to the app's owner (contact, booking, enquiry, waitlist) needs no wallet: give its collection "create": "anyone" and "read": ["writer", "owner"] (see the app-data guide). Above the submit button say plainly who reads it, for example "Only the salon owner sees your name and phone number."
- "Sign up" / "join" / "log in" for a personal area means connecting a wallet and signing in: a Signup page that explains what joining gives, a big button calling useDbSession().signIn() (or ConnectButton if nothing is saved), and a success state with the shortAddress that sends them on (Link to the app page). Never build passwords or a fake account system.
- A form that must save what people enter uses the app-data guide: sign in, then save to a collection. Never pretend a form was sent, never save to localStorage as if it were stored, and never send form data to third-party URLs.
- Who can read the entries matters. The owner reads what was sent in GoodBuild's Backend window (and in the app, when signed in with the owning wallet, through session.isOwner). Never put emails, phone numbers or anything personal in a collection that "anyone" reads, or in its "public" fields.
- Form craft: Label + Input pairs (htmlFor/id), helpful placeholder, required fields marked, inline validation on blur and submit (text-danger text-xs under the field), the submit button disabled while pending with a "Joining…" label, and a Notice for success or failure. type="email", inputMode="decimal" for amounts, autoComplete where it helps.
- Keep forms short: ask only for what the app uses. One column on mobile, max-w-md.`,
  },
  {
    name: "app-data",
    when: "the app must remember something between visits or show what other people wrote: notes, profiles, saved settings, posts, comments, lists, RSVPs, or any form that stores what people enter",
    body: `Saved data. Published apps can store data on GoodBuild's servers, with no setup. Use src/lib/db.ts and src/lib/useDb.ts (they exist already; don't edit them). Never invent a backend, an API route, or a third-party database: none of those will work.
- Choose the store first. Money, ownership, votes, or anything people must be able to verify without trusting GoodBuild goes in a contract. Everything else (profiles, notes, comments, drafts, preferences, off-chain lists) goes here. Data here is not on-chain and can be removed, so never make it the record of who owns or owes what.
- Sign-in: useDbSession() gives {wallet, email, signedIn, isOwner, emailSignIn, loading, signingIn, codeSentTo, error, signIn, sendCode, confirmCode, signOut, isPreview}. Use signedIn (not wallet) to decide what to show and for enabled.
  Wallet: signIn() connects the wallet if needed and asks for a signature (no transaction, no gas). Say that on the button. Use it for apps about money, ownership or on-chain actions, and wherever a wallet is needed anyway.
  Email: for regular apps where visitors may have no wallet (bookings, clubs, lists, a course). Add "signIn": {"email": true} at the top of src/lib/dataRules.json, beside "collections". Show an email field calling sendCode(email), then, once codeSentTo is set, a 6-digit code field (inputMode="numeric", autoComplete="one-time-code") calling confirmCode(code), with "Use a different email" and a resend link. Show error in a Notice. Offer both when the app has money and regular members. Never build passwords.
  isOwner is true when the app's owner is signed in with their wallet (always in the preview), so show an owner view, such as every booking, behind it.
  An email visitor's id isn't their address, and other people never see it. If the owner needs a way to contact someone, ask for it in a form field and say why.
- Rules live in src/lib/dataRules.json. Design them for this app: add every collection you use. A rule is "private", "public-read", or an object:
    {"collections": {
      "notes": "private",
      "posts": "public-read",
      "bookings": {"create": "anyone", "read": ["writer", "owner"], "delete": ["writer", "owner"], "public": ["day", "time"],
                   "fields": {"name": "string", "phone": "string", "day": "string", "time": "string"}, "unique": ["day", "time"]}
    }}
  create: who can add a record. "signed-in" (the default) needs wallet sign-in; "anyone" takes records from visitors who never sign in (forms sent to the owner); "owner" means only the app's owner adds them (announcements, menus).
  read: who sees whole records, any of "writer" (the default), "owner" (the app's owner), "signed-in", "anyone". The owner reads only where you list "owner".
  delete: "writer" and/or "owner". update: ["writer"] (the default) or [] so records can't be edited once sent.
  public: fields everyone sees without who wrote them, for example which time slots are taken. fields: the allowed fields and their types ("string", "number", "boolean"); a write with other fields is refused. unique: field values no two records may share (no double booking); they must also be in public.
  "private" equals {"read": ["writer"]}. "public-read" equals {"read": ["anyone"]}. Only list "anyone" in read for things people mean to publish (posts, comments, listings), never personal details.
  A rule takes effect when the app is published again. A record is never more visible than the rule it was saved under, so loosening a rule doesn't expose older records.
- Each wallet has its own records. Two wallets using the same key get two separate records, so there's no shared record everyone edits, and no counter everyone increments: count by listing, or use a contract.
- Queries. A list can be narrowed and sorted on the server, on the fields the visitor can see (a filter never compares a field they can't read, so a hidden field never matches):
    const open = useCollection<Task>("tasks", { where: [["status", "eq", "open"], ["points", "gte", 10]], orderBy: "points", dir: "desc", limit: 20 });
  Comparisons: eq, ne, gt, gte, lt, lte, on text, numbers and true or false, with the value the same type as the field. At most 4 conditions. orderBy is a field or "createdAt" or "updatedAt". A filtered list reads the newest 500 records of the collection and sets truncated when there were more, so a leaderboard over a big collection should keep one record per player (put("best", ...)) rather than add every game. A filtered list has no cursor.
  To see what changed since a moment, collection("scores").list({ since: lastUpdatedAt }) returns records saved or changed after it, for a cheap refresh. Take lastUpdatedAt from the newest updatedAt you received (the server's clock), never from Date.now() on the phone. If the answer has truncated: true, there were more changes than one answer holds: ask again with the same since and a bigger limit before moving it forward. since never shows a deleted record, so mark a record finished or removed with a status field rather than deleting it when other screens must notice.
- Reading and writing:
    const session = useDbSession();
    const notes = useCollection<Note>("notes", { enabled: session.signedIn, wallet: session.wallet ?? session.email });
    await notes.add({ text });            // new record with a generated key
    await notes.put("profile", { name }); // your record under a key you pick; replaces your earlier one
    await notes.remove(record.key);
    const bookings = useCollection<Booking>("bookings");   // a form sent without sign-in: no enabled check needed to add
    await bookings.add({ name, phone, day, time });        // a taken slot throws with code "duplicate": say it's taken
  notes.records is newest first; each has key, owner (lowercase, or null when you only see its public fields), value, createdAt, updatedAt. The owner removes someone else's record with remove(record.key, record.owner). Show a public feed with useCollection<Post>("posts") and no sign-in; add { owner: address } for one person's records. For one record outside React: const r = await collection<Profile>("profiles").get("me") from src/lib/db.ts (null if there's none; { owner } reads someone else's public record).
- Names: collections use lowercase letters, numbers, - and _, starting with a letter. Keys use letters, numbers, _ . : -, starting with a letter or number, and at most 128 characters.
- Limits: 16 KB per value, 1,000 records and 2 MB per wallet, 20,000 records and 20 MB per app. Values are JSON: no files or images. Writes throw when a limit is reached, with a message you can show: wrap them in try/catch and show errorMessage(e) in a Notice. list() returns 50 at a time, 100 at most; pass nextCursor as cursor for more.
- Offer a "Delete my data" action (deleteMyData() from src/lib/db.ts) somewhere reasonable, such as a settings or profile area, in any app that stores anything personal.
- Never trust record values when rendering: React escapes text, so render them as text and never with dangerouslySetInnerHTML. Treat another wallet's values as untrusted, including links (allow only https:).
- States: Skeleton while loading (session.loading, notes.loading); when signed out, explain what signing in gives, with the button; an empty state; errors in a Notice. In the preview records stay in that browser and sign-in needs no signature, and a small note says so; say this once in your reply when you add saved data, and that they need to publish for real storage.`,
  },
  {
    name: "visual-design",
    when: "the first build of any website or page people will judge by its looks (landing page, portfolio, shop, event, a dApp's front door), a redesign, or the user says it looks plain, generic, boring or like a template",
    body: `Visual design: decide the look on purpose, then hold to it on every screen.
- Art direction first. Before any file, write one sentence in set_plan's summary: who it is for, the mood, and the one thing a visitor should remember. Then pick ONE direction and take its whole recipe, set through the tokens in public/index.html (design-tokens guide):
  1. Editorial: off-white background (#faf8f5), near-black text, a serif display font (Fraunces or Playfair Display), big headlines with tight tracking, thin rules between sections, one muted accent, photos or large type instead of icons. For causes, stories, portfolios, cafes.
  2. Soft and friendly: light tinted background, rounded-2xl or rounded-3xl cards, a rounded display font (Fredoka, Nunito), pastel surfaces with one saturated accent, icon tiles. For communities, clubs, kids, savings groups.
  3. Bold poster: a strong colour or near-black behind the hero, very large uppercase or heavy display type (Unbounded, Archivo Black), high contrast, blocks of flat colour, few words. For events, launches, music, sport.
  4. Clean product: white, a geometric sans (Space Grotesk or Outfit for headings, Inter for body), a bento grid of mixed-size cards, hairline borders in place of shadows, one accent used sparingly. For tools, dashboards, SaaS, wallets.
  5. Dark and technical: near-black background (#0b0d12), surfaces one step lighter, light text, one bright accent that seems to glow (a soft blurred shape of it behind the hero), mono labels (JetBrains Mono, text-xs uppercase). For DAOs, protocols, developer tools, games.
  6. Warm market: cream or sand background, earthy accent (terracotta, deep green, indigo), Outfit or DM Sans, generous photos if uploaded, pattern or texture from simple CSS shapes. For shops, food, crafts, local services.
  The person's chosen palette (in the context, if they picked one) wins on colour; take the type, shape and layout from the direction that suits it.
- Type does most of the work. Two families at most. A real scale with contrast: the hero headline is 3 to 4 times the body size (text-4xl sm:text-6xl against text-base), tracking-tight on large type, leading-relaxed on body, lines no longer than about 65 characters (max-w-prose or max-w-xl on paragraphs). One weight for headings, one for body, font-medium for labels. Numbers get tabular-nums.
- Colour: mostly neutral, some surface, a little accent (about 60 / 30 / 10). Neutrals tinted toward the accent look designed; pure grey looks default. The accent is for the main action, key numbers and small marks only. Give long pages rhythm with one section in a contrasting band (bg-primary text-primary-foreground, or bg-muted).
- Layout: vary it. A centred hero followed by three identical cards, repeated, is the template look. Alternate: a split hero (words one side, a mock of the product or a big number the other), a bento grid where one card spans two columns, a full-width band, a two-column section with a sticky heading. Align everything to one content width (max-w-6xl) and one spacing step between sections (py-16 sm:py-24). Leave more empty space than feels necessary.
- Show the product. The strongest hero visual for an app is the app: a card built from the real components (the tip form, a stat row, a proposal card) at a slight tilt or overlapping the edge, not an abstract shape. For a dApp, real numbers from the contract, or clearly labelled examples before deploy.
- Depth, lightly: borders at low contrast (border-border), shadow-sm on cards and one larger soft shadow on the hero mock, a gradient only as a faint wash (from-accent/10 to-transparent). No heavy drop shadows, no rainbow gradients, no glass blur on light pages.
- Every clickable thing answers: hover (hover:bg-*, hover:-translate-y-0.5 with transition), active, focus-visible ring, disabled. Cards that link somewhere lift a little on hover. Links in text are underlined or accent-coloured.
- Motion, when the page should feel alive: turn on the motion kit (add_kit("motion")) and follow its guide. One hero moment, reveals on scroll, nothing on forms.
- Details that read as finished: an eyebrow chip above the headline (rounded-full border px-3 py-1 text-xs), icon tiles (size-10 rounded-xl bg-accent/10 text-accent) instead of bare icons, a footer with real links, a favicon and title that match, consistent radius everywhere.
- The template tells, never ship these: emoji used as icons, a purple-to-blue gradient on white for no reason, every section centred, the same card repeated in every section, more than two fonts, placeholder names like "Acme" or "John Doe", invented testimonials or statistics, a headline that is only the app's name.
- Phone first: one column, the main action reachable by a thumb, tap targets at least 44px tall (h-11 or py-3), text no smaller than text-sm, nothing that scrolls sideways.
- Before run_checks, look at your own page as a visitor would: is there one clear thing to do, does the top of the page say what this is in five words, and would two different apps you built look different from each other?`,
  },
  {
    name: "design-tokens",
    when: "the user asks to change the look (colours, fonts, dark mode, 'make it greener', a brand), or you are styling a new app or page",
    body: `Design tokens: the look lives in the @theme block of public/index.html, not in component classes.
- Use semantic token classes only: bg-background, bg-muted, bg-card, text-foreground, text-muted-foreground, border-border, bg-primary text-primary-foreground, bg-accent text-accent-foreground, text-success / text-warning / text-danger, ring-ring. Opacity modifiers are fine (bg-accent/10).
- Don't use raw palette classes (bg-white, text-gray-500, bg-blue-600, text-black). If you need a colour that has no token, add a token to @theme first (e.g. --color-highlight: #f5b301;) and use bg-highlight.
- Before using a token, check that public/index.html defines it (older projects may lack --color-card, --color-accent-foreground, --color-ring or --font-display); add any that are missing.
- "Make it greener" or a brand colour: change --color-accent (and --color-primary if the brand is dark or bold), keep contrast at least 4.5:1 for text on the colour, update --color-accent-foreground to match.
- Fonts: you may add one Google Fonts <link> in the <head> of public/index.html and set --font-sans (body) and --font-display (headings: add font-display to h1/h2 and big numbers). Keep it to two families. Pairings by mood (display / body):
  bold and modern: "Space Grotesk" / "Inter"; friendly: "Fredoka" or "Nunito" / "Nunito Sans"; editorial and warm: "Fraunces" / "Inter"; elegant: "Playfair Display" / "Source Sans 3"; techy: "JetBrains Mono" (labels only) / "Inter"; loud event poster: "Unbounded" or "Archivo Black" (uppercase headings) / "Inter"; African-market warmth: "Outfit" / "DM Sans".
  Type scale: h1 text-4xl sm:text-5xl, h2 text-2xl sm:text-3xl, body text-base leading-relaxed, small text-sm text-muted-foreground. Display fonts for headings and numbers only, never paragraphs or buttons.
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
- Layout: max-w-3xl prose column, h1 + one-line intro, then h2 sections with short paragraphs (text-muted-foreground leading-relaxed) and lists. FAQ as an Accordion (src/components/ui/accordion.tsx, ui-components guide), 4 to 8 real questions about using this app.
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
- Front end: a token card with name, symbol, total supply (formatAmount with decimals()), the connected wallet's balance, and a Send form (address + amount, validated with isAddress from viem). Add the token to the wallet with wallet_watchAsset (EIP-747) via a small "Add RTX to wallet" button once deployed: walletProvider()?.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address, symbol, decimals } } } as never) with walletProvider from src/lib/chain.ts (never window.ethereum).`,
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
- A contract that needs another one takes its address as a constructor argument (IERC20 rtx_, not a hard-coded address and not created inside with new). Name constructor arguments clearly (rtxToken_, gd_); the deploy manifest fills them by name.
- List every contract in contracts/deploy.json (see the deploy manifest rule): the other contract's address is "\${RTXToken.address}" and the G$ token is "\${GOODDOLLAR}". GoodBuild deploys them in dependency order, one wallet signature each, and fills the addresses in. Say the order in your reply, e.g. "RTXToken deploys first, then RTXPool."
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
- Native CELO (tips, payments, escrow, payable functions): the test contract itself starts with 1,000 CELO, and every actor can hold CELO. Hand some over with fund(alice, 1 ether); send it with a call as that actor with alice.execValue(address(jar), abi.encodeCall(jar.tip, ("hi")), 0.1 ether); expect a failing paid call with expectRevertValue(alice, address(jar), abi.encodeCall(...), 0.1 ether, "msg"). A test that sends value straight from the test contract can call jar.tip{value: 0.1 ether}("hi") directly, but then msg.sender is the test contract. If the test contract is the owner and collects a withdrawal, declare receive() external payable {} in it. Don't write your own helper contracts to carry value: use fund and execValue.
- No cheatcodes exist (no vm.prank, no warp). block.timestamp is a fixed realistic time, so use block.timestamp + 600 for a live deadline and block.timestamp - 1 for an expired one.
- Work out expected amounts with the same formula as the contract in the test (e.g. compute getAmountOut first, then assert the balance equals it) instead of hand-typed numbers.`,
  },
  {
    name: "multiplayer",
    when: "several people using the app at the same time: a game room or lobby, turn-based play between people, live chat, a shared board or leaderboard that updates, or anything that must feel live",
    body: `Apps where people see each other's changes. GoodBuild has no live connection (no websockets), so these apps ask for the latest every few seconds. That suits turn-based games, lobbies, chats, polls and leaderboards. It doesn't suit fast action games where players must see each other move within a fraction of a second: don't promise that, and say so plainly if asked.
- Keep it live with useCollection(name, { liveEvery: 3000 }): it fetches again every 3 seconds (never less than 2) while the page is showing. Use where and orderBy to read only what this screen needs (see the app-data guide), for example the moves of one room: useCollection("moves", { where: [["room", "eq", roomId]], orderBy: "n", dir: "asc", liveEvery: 3000 }).
- Each person writes only their own records. A shared state is the sum of everyone's records: a room is a record its creator saved (with public fields: room id, name, status), each player's join is their own record with the room id, and each move is its own record with the room id and a number. Everyone derives the same state by reading all the records of the room in order, so nobody edits someone else's record and nothing needs a lock.
- Whose turn it is, who joined and who won are worked out from the records, the same way on every screen: for example the next move number n decides the player by n % players. Two players may submit a move for the same turn; every screen must resolve it the same way (the lower number of n and then the earlier createdAt wins, the other is shown as "too late, try again").
- Make the fields the room needs public in dataRules.json (room, n, player name, status) so other players can read them without seeing who wrote them, and keep anything personal out of them. Records are readable by everyone in the collection's read list: don't put secrets (a hidden card, a secret word) in a record other players can read.
- Don't delete to end a game: add a record or set a status field, so late screens still see how it ended. The records of a finished room can stay.
- Show the live parts calmly: keep the last good list on screen while a fetch is running, show "Updating" only if it takes more than a second, and when a fetch fails show "Reconnecting..." and keep trying. Never blank the board between refreshes.
- Money (entry fees, prizes, pots) never lives in these records. It goes through a contract, with the organiser settling the result (see the games guide). A score or a winner stored here is a claim, not proof.
- Be honest about size: about 50 people at a time is what the data store is sized for. A room of 2 to 8 players is the target.`,
  },
  {
    name: "cross-chain",
    when: "cross-chain, bridge, multichain, other networks, or moving tokens between chains",
    body: `Cross-chain requests.
- GoodBuild apps run on the Celo network selected for their project. Use the chain export from src/lib/chain.ts for all contract reads and writes; never hardcode a different network. Real bridging to other chains needs a bridge protocol and relayers that GoodBuild doesn't integrate, and hand-written bridges are a major source of hacks. Don't write a bridge contract, a "lock and mint" contract, or anything that claims to move tokens to another chain.
- Usually the user means swapping between Celo tokens (G$ to cUSD, G$ to their own coin). Build that on Celo with the swaps-and-markets guide (an in-app pool), and say in one sentence that true cross-chain transfers aren't supported yet.
- If they need to reach a coin that has no pool in the app, say that swapping it needs an external DEX or bridge that the app doesn't connect to yet, and leave a clear "Coming later" state in the UI rather than a fake button.`,
  },
  {
    name: "brand-and-assets",
    when: "the user uploaded a logo or images (see Uploaded assets), or asks to use their logo, brand or colours",
    body: `Using the user's logo, images and brand colours.
- Uploaded files are served at /assets/<name>. In code: import { assets } from "./assets" (relative to the file, e.g. "../assets" from src/components/) and use assets.logo.src, .width, .height, .alt. A literal "/assets/logo.png" string also works (needed in public/index.html). Never invent a path: the build rejects /assets/ paths that weren't uploaded.
- Logo in the header: <img src={assets.logo.src} alt={assets.logo.alt} className="h-8 w-auto" /> next to (or instead of, if the logo includes the wordmark) the app name, linking home. Keep its aspect ratio (h-* with w-auto). Also in the footer at h-6. Don't recolour or crop it.
- Favicon: in public/index.html <head>: <link rel="icon" href="/assets/logo.png" /> (use the logo's real name and type; type="image/svg+xml" for SVG).
- Brand colours from the logo: the manifest lists its palette, most dominant first. Set --color-primary to the strongest saturated brand colour and --color-accent to the second (or a lighter tint of the first). Set --color-primary-foreground and --color-accent-foreground to #ffffff or #0b0b0b, whichever gives at least 4.5:1 contrast. Keep --color-background and --color-muted calm (white or a very light tint of the primary, e.g. 4% mix), not the logo's raw colours. Near-black or near-white palette entries are usually the outline or background: ignore them for primary.
- A logo meant for dark backgrounds (the description says so) goes on a bg-primary or dark header band, or ask for a light version in your reply.
- Other uploads (sounds, fonts, 3D models) appear in the same list with a note on how to use each. A sound is played with new Audio(assets.<key>.src) from a tap (phones block sound before one), a font goes through @font-face (see its note) and then into --font-display or --font-sans, a .glb model goes to the 3D kit's GLTFLoader.
- Images: hero and showcase images in a rounded frame with object-cover and a fixed aspect; always alt text from the manifest description; loading="lazy" below the fold. Design references are NOT files to show: see match-reference.`,
  },
  {
    name: "match-reference",
    when: "the user uploaded a design reference (screenshot, mockup) or asks to match a look, site or image",
    body: `Matching a design reference.
- The reference's layout spec is in the Uploaded assets list (and the image itself is attached to the message it was uploaded with). Treat it as the brief for structure and style, and the user's words as the brief for content.
- Rebuild the STRUCTURE first: same navigation style, same section order, same column counts and alignment, similar proportions (hero height, card sizes). Name the sections in set_plan in the reference's order.
- Then the STYLE through tokens: background, surface, text and accent colours from the spec's hex values into @theme (keep contrast ≥ 4.5:1); heading font of the same character (serif, geometric sans, condensed, rounded) via --font-display (see design-tokens pairings); matching radius (rounded-none / rounded-lg / rounded-3xl), borders vs shadows, density (spacing scale).
- Content: use the user's app and copy, not the reference's brand name, logos, people or text. Placeholder imagery the reference has (photos) becomes uploaded assets if any, otherwise gradients, icons or component mocks.
- Don't copy anything you can't see in the spec; when the spec is vague, pick the simpler option.
- In your reply, say in one sentence what you matched (e.g. "Matched the split hero, three-card features row and dark footer").`,
  },
  {
    name: "ui-states",
    when: "any page that loads data, submits a form or calls a contract (loading, empty, error, success states), or lists that can be empty",
    body: `States every screen needs. Design them, not just the happy path.
- Loading: Skeleton shapes that match the final layout (a stat card skeleton is h-8 w-24; a list is 3 rows of h-12). Never a blank area or a lone spinner for content; spinners only inside buttons (lucide Loader2 animate-spin) with a pending label ("Sending…").
- Empty: a short sentence that says what will appear and how to make it happen, plus the main action ("No tips yet. Be the first to tip the club." + button). Optional muted lucide icon above (size-8 text-muted-foreground). Lists, leaderboards, galleries and histories all need one.
- Error: Notice tone="danger" with errorMessage(e) in plain words and a retry (refresh from useRead, or re-enable the form). Keep the rest of the page usable. A user rejecting the wallet prompt is not an error: show nothing or a quiet "Cancelled".
- Not deployed: when the contract address is undefined, a friendly Notice ("Deploy the contract to go live") with the page shown in a disabled state and placeholder values labelled as examples.
- Not connected: actions that need a wallet show the ConnectButton in place of the action button, with one line explaining why. ConnectButton opens GoodBuild's wallet list (browser wallets, phone wallets by WalletConnect once published, MiniPay on its own); closing the list is not an error.
- Success: Notice tone="success" after a write with what happened ("Tipped 50 G$"), then refresh reads. Clear the form.
- 404 page and a fallback for unknown routes (pages-and-routing).`,
  },
  {
    name: "ui-components",
    when: "a pop-up or confirmation (dialog), a slide-in panel or phone menu (sheet), tabs, a dropdown of choices (select) or of actions (dropdown menu), a tooltip, a toast, an FAQ or collapsible section (accordion), an avatar for a person or wallet, or an on/off switch",
    body: UI_GUIDE,
  },
  {
    name: "file-structure",
    when: "adding several files, pages or components, splitting a big file, or reorganising the project",
    body: `File names and where things go (new files with other names are refused):
- src/App.tsx: entry; the router and route table only, once there are pages.
- src/pages/PascalCase.tsx: one page per file, default export named after the page (Home, About, Jar, Proposal).
- src/components/PascalCase.tsx: shared pieces (Layout, Header, Footer, TipForm, StatCard). Landing-page sections in src/components/sections/PascalCase.tsx (Hero, Features, Faq, CtaBand).
- src/components/ui/: the starter primitives (button, card, ...). Add new primitives here in lowercase (e.g. tabs.tsx).
- src/lib/useCamelCase.ts: hooks (useTipJar, useToken). src/lib/camelCase.ts: helpers (format, chain, utils).
- contracts/PascalCase.sol: one main contract per file, file name = contract name. contracts/test/PascalCase.t.sol: its tests.
- /assets/<name>: uploaded images, imported from src/assets (written by GoodBuild; don't create files there).
- src/contracts/: ABIs and addresses, written by GoodBuild.
- Name files for what they show or do (TipForm, not Form2 or Component). One component per file unless a helper is tiny and private.
- When you rename or move a file, update every import of it (find_symbol or search_code for the old path).`,
  },
];

// A kit's guide is a guide like any other, named kit-<id> (D71).
const BY_NAME = new Map([...GUIDES, ...KITS.map((k) => ({ name: kitGuideName(k.id), when: k.when, body: k.guide }))].map((g) => [g.name, g]));

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
