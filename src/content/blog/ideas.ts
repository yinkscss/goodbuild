import type { Post } from "./types";

const date = "2026-11-10";

export const ideasPosts: Post[] = [
  {
    slug: "what-is-g-dollar-gooddollar-apps",
    query: "what is g$ gooddollar token",
    cluster: "ideas",
    title: "What Is G$ (GoodDollar) and How to Build Apps With It",
    description: "G$ is the GoodDollar token on Celo. What it is, why builders use it and which kinds of apps can collect, split and pay out G$ with GoodBuild.",
    date,
    intro: "G$ is the GoodDollar token, a standard ERC-20 coin on the Celo network. GoodBuild is made for the GoodDollar community, so apps that collect, split and pay out G$ are a natural fit.",
    sections: [
      {
        heading: "The basics",
        paragraphs: [
          "GoodDollar is a project that aims to put a digital basic income into more people's hands. G$ is its token. On Celo it works like any ERC-20 token: a wallet holds it, and a contract can receive and send it.",
          "Check GoodDollar's own site for the current details of how the token is issued and claimed, because the project evolves.",
        ],
      },
      {
        heading: "Why build with it",
        bullets: ["There are already people who hold G$ and know it.", "A small-amount token suits small community apps.", "Celo fees are low, so small payments make sense."],
      },
      {
        heading: "What apps work with G$",
        bullets: [
          "[Savings circles](/blog/build-savings-circle-app)",
          "[Tip jars](/blog/build-tipping-app-g-dollar)",
          "[Fundraisers](/blog/build-crowdfunding-dapp)",
          "[Loyalty rewards](/blog/build-loyalty-rewards-app)",
          "[Games with an entry fee](/blog/build-skill-game-with-entry-fee)",
        ],
      },
      {
        heading: "Building it in GoodBuild",
        paragraphs: ["Say in your prompt that the app uses G$. GoodBuild treats it as a standard ERC-20 token. Test on Celo Sepolia first, since G$ on mainnet is real value. Start at [GoodBuild](/)."],
      },
    ],
    faq: [
      { q: "Is G$ on Celo?", a: "Yes. G$ is available as a token on Celo, and GoodBuild treats it as a standard ERC-20." },
      { q: "Should I test with real G$?", a: "Test with test tokens on Celo Sepolia first. Use real G$ only after the app behaves as you expect." },
      { q: "Where do I learn more about GoodDollar?", a: "On [GoodDollar's own site](https://www.gooddollar.org), which is the source for how the token works today." },
    ],
    related: ["build-savings-circle-app", "build-tipping-app-g-dollar", "how-to-build-a-dapp-on-celo"],
  },
  {
    slug: "build-savings-circle-app",
    query: "how to build a savings circle app",
    cluster: "ideas",
    title: "Build a Savings Circle App (Ajo, Esusu, ROSCA) With AI",
    description: "Build a digital savings circle where members pay weekly and the pot rotates. The rules to decide, how a contract enforces them and how to test it.",
    date,
    intro: "A savings circle is a group that pays in a fixed amount each round, with the whole pot going to one member per round. A smart contract can hold the pot and enforce the order.",
    sections: [
      {
        heading: "Rules to decide first",
        bullets: [
          "How many members, and how much each pays per round.",
          "How the payout order is chosen: fixed list, or drawn once at the start.",
          "What happens when a member misses a payment.",
          "Whether a member can leave early.",
          "Which token: G$ or a stablecoin.",
        ],
      },
      {
        heading: "A prompt to start with",
        paragraphs: ["\"A weekly G$ savings circle for 12 members. Everyone deposits 50 G$ every Friday and the pot rotates to one member each week in a fixed order. If someone misses a week, the round waits until they pay.\""],
      },
      {
        heading: "Steps",
        steps: ["Paste the prompt into [GoodBuild](/) and answer the questions.", "Test with three wallets on Celo Sepolia, including one that misses a payment.", "Read the contract summary and check the payout order.", "Deploy and publish, then invite the group."],
      },
      {
        heading: "Risks",
        bullets: ["A circle holds the group's money. Get a human review before using real funds.", "Trust is the real product: members should understand the rules before joining.", "Legal treatment of savings groups varies. You are responsible for what you run."],
      },
    ],
    related: ["what-is-g-dollar-gooddollar-apps", "build-crowdfunding-dapp", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "build-tipping-app-g-dollar",
    query: "how to build a tipping app crypto tip jar",
    cluster: "ideas",
    title: "Build a Crypto Tip Jar App for Creators and Small Shops",
    description: "Build a tip jar page where fans send a small amount in G$ or stablecoins straight to you. What to include, how to build it and how to share it.",
    date,
    intro: "A tip jar is the simplest money app: a page with a few preset amounts and a button, where the money goes straight to your wallet.",
    sections: [
      {
        heading: "What a good tip page has",
        bullets: ["Your name and one line about what you do.", "Three amounts and a custom one.", "A short thank-you after payment.", "A list of recent tips, if you want a public wall."],
      },
      {
        heading: "Do you need a contract?",
        paragraphs: ["Not for a plain tip jar. The page asks the supporter's wallet to send tokens directly to your address. A contract is useful only if you want things like a public tip list or splits between several people."],
      },
      {
        heading: "Steps",
        steps: ["Describe the page in [GoodBuild](/): your name, the token, the amounts.", "Preview on a phone-sized window.", "Send yourself a test tip on Celo Sepolia.", "Publish and put the link in your profile or on a printed QR code."],
      },
      {
        heading: "Ideas",
        bullets: ["A market stall with a QR code on the counter.", "A musician at a venue.", "A teacher with a thank-you page for parents."],
      },
    ],
    faq: [
      { q: "Do tippers need a crypto wallet?", a: "Yes, a wallet is needed to send tokens. Inside MiniPay it is already there, so a MiniPay-friendly page is the easiest for new users." },
      { q: "Can I get tips in a stablecoin?", a: "Yes. Choose a Celo stablecoin as the token so the value doesn't move between the tip and when you spend it." },
      { q: "Are there fees?", a: "The network charges a small fee per transfer, paid by the sender. GoodBuild does not take a cut of a tip." },
    ],
    related: ["build-invoice-payment-link-app", "what-is-g-dollar-gooddollar-apps", "minipay-mini-app-ideas"],
  },
  {
    slug: "build-crowdfunding-dapp",
    query: "build a crowdfunding dapp",
    cluster: "ideas",
    title: "Build a Crowdfunding dApp With a Goal and a Refund Rule",
    description: "Build a crowdfunding app where money is held until a goal is met and returned if it isn't. The rules, the contract logic and how to test it on Celo.",
    date,
    intro: "A crowdfunding dApp holds supporters' money in a contract, pays the organiser if the goal is reached by the deadline, and returns it if not.",
    sections: [
      {
        heading: "Rules",
        bullets: ["The goal amount and the deadline.", "The token.", "Who receives the funds on success.", "How refunds work on failure: automatic, or each supporter claims theirs.", "Whether the goal can be changed. Usually it shouldn't."],
      },
      { heading: "Why a contract", paragraphs: ["Supporters trust a rule they can read more than a promise. The contract can't spend the money for another purpose, and the refund rule runs whether or not the organiser is around."] },
      {
        heading: "Steps",
        steps: ["Write the rules as a paragraph and add it to [GoodBuild](/).", "Test the success path, the failure path and a payment after the deadline on Celo Sepolia.", "Show a progress bar and a countdown on the page.", "Have the contract reviewed before real money is raised."],
      },
      { heading: "Be careful", paragraphs: ["Fundraising can be regulated in your area. This post is not legal advice. Say clearly what the money is for and who you are."] },
    ],
    faq: [
      { q: "What happens if the goal isn't met?", a: "In the design described here, supporters get their money back. The refund rule is written into the contract, so it doesn't depend on the organiser." },
      { q: "Can the organiser withdraw early?", a: "Only if you write that rule. Most designs forbid it, because the point is that supporters' money stays put until the goal is met." },
      { q: "Do supporters need to trust me?", a: "Less than with a plain promise, because they can read the rules. They still need to trust the cause, so say who you are." },
    ],
    related: ["build-savings-circle-app", "build-escrow-app-no-code", "build-dao-voting-app-no-code"],
  },
  {
    slug: "build-invoice-payment-link-app",
    query: "payment link and invoice app on celo",
    cluster: "ideas",
    title: "Build a Payment Link and Invoice App on Celo",
    description: "Build a page that sends a client a link to pay an exact amount in stablecoins or G$, then shows you who paid. For freelancers and small businesses.",
    date,
    intro: "A payment link app lets you send a client one web address that asks for an exact amount. When they pay, you both see it.",
    sections: [
      {
        heading: "What it needs",
        bullets: ["A form where you enter the amount, a note and a reference.", "A link or QR code for the payer.", "A payment page that shows the amount and recipient clearly.", "A list of paid and unpaid invoices."],
      },
      {
        heading: "Steps",
        steps: ["Describe it in [GoodBuild](/), including the token and who sees what.", "Create a test invoice and pay it from a second wallet on Celo Sepolia.", "Check that the paid status shows up for you.", "Publish and use it for a real small invoice."],
      },
      {
        heading: "Tips",
        bullets: ["Put the reference number on the page and in the wallet note.", "Show the amount with the token's name, never alone.", "Keep invoice details private if they contain client information."],
      },
      { heading: "Related", paragraphs: ["For a no-fuss version, see the [tip jar guide](/blog/build-tipping-app-g-dollar). For payments that wait for a delivery, see [escrow](/blog/build-escrow-app-no-code)."] },
    ],
    faq: [
      { q: "Can a client pay without installing anything?", a: "They need a wallet. Inside MiniPay there is nothing extra to install; otherwise they can use a browser or phone wallet." },
      { q: "How do I know an invoice was paid?", a: "The payment is on the blockchain, so the page can check it and mark the invoice as paid." },
      { q: "Should I use this for large amounts?", a: "Start with small ones. For large payments, test carefully, and consider [escrow](/blog/build-escrow-app-no-code)." },
    ],
    related: ["build-tipping-app-g-dollar", "build-escrow-app-no-code", "stablecoin-payment-app-celo"],
  },
  {
    slug: "build-loyalty-rewards-app",
    query: "build a loyalty rewards app for a small business",
    cluster: "ideas",
    title: "Build a Loyalty Rewards App for a Small Business",
    description: "Build a points app for a shop or cafe: customers earn tokens for purchases and spend them on rewards. What to decide and how to launch it.",
    date,
    intro: "A loyalty app gives customers points when they buy and lets them spend the points on rewards. A token on Celo can be the points.",
    sections: [
      {
        heading: "Design choices",
        bullets: ["What earns points: each purchase, a visit, a referral.", "What points buy.", "Do points expire?", "Can points be transferred? Often better to say no."],
      },
      {
        heading: "Steps",
        steps: ["Describe the earning and spending rules in [GoodBuild](/).", "Make a staff screen to give points and a customer screen to see them.", "Test on Celo Sepolia with a staff wallet and two customers.", "Print a QR code for the counter."],
      },
      { heading: "Keep it simple", paragraphs: ["A card with ten stamps beats a complex tier system. Start with one reward and add more once people use it."] },
      { heading: "Privacy", paragraphs: ["Wallet addresses are public on the blockchain. If you collect names or phone numbers, tell customers, and don't save anything you don't need."] },
    ],
    faq: [
      { q: "Do I need a token for loyalty points?", a: "Not always. A token makes points portable and visible in a wallet; a simple counter in the app is easier if you don't need that." },
      { q: "Can customers cheat?", a: "Only staff should be able to give points, and the contract should check that. Test it with a customer wallet that tries to give itself points." },
      { q: "What if a customer has no wallet?", a: "Offer a short guide at the counter. MiniPay users already have one." },
    ],
    related: ["create-erc20-token-no-code", "build-airdrop-app", "minipay-mini-app-ideas"],
  },
  {
    slug: "build-escrow-app-no-code",
    query: "build an escrow app smart contract",
    cluster: "ideas",
    title: "Build an Escrow App: Pay Safely Until the Work Is Done",
    description: "An escrow contract holds a payment until both sides agree the work is delivered. Design the rules, build it with AI and test the dispute paths.",
    date,
    intro: "Escrow holds a buyer's payment in a contract and releases it to the seller when the buyer confirms delivery, or returns it if the deal fails.",
    sections: [
      { heading: "Rules to decide", bullets: ["Who funds it and who gets it.", "What triggers release: buyer approval, a time limit, or both.", "What happens if the buyer goes silent.", "Is there a third person who decides disputes?", "Which token."] },
      { heading: "Steps", steps: ["Write the deal flow as numbered steps.", "Add them to [GoodBuild](/) and answer the questions.", "Test: happy path, buyer refuses, seller never delivers, nobody responds.", "Get a human review. An escrow holds other people's money."] },
      { heading: "The hard part", paragraphs: ["The code is easy; disputes are hard. A contract can't judge whether a logo is good. Choose a rule people accept before they put money in, such as a named arbiter."] },
      { heading: "Related", paragraphs: ["For a simpler approach, see [payment links](/blog/build-invoice-payment-link-app)."] },
    ],
    faq: [
      { q: "What is escrow?", a: "A third party, here a contract, holds money until the agreed conditions are met, then releases it to the right person." },
      { q: "Who can release the money?", a: "Whoever the contract names: usually the buyer, with an arbiter for disputes. Choose this before anyone pays." },
      { q: "Is it safe for large deals?", a: "Not without a human review. Escrow contracts hold other people's money, and generated code is unaudited." },
    ],
    related: ["build-invoice-payment-link-app", "build-crowdfunding-dapp", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "build-skill-game-with-entry-fee",
    query: "skill game with g$ entry fee and prizes",
    cluster: "ideas",
    title: "Build a Skill Game With a G$ Entry Fee and Prizes",
    description: "Build a 2D skill game on Celo that charges a G$ entry and pays the top score. How it works, why chance-based games are excluded and how to test it.",
    date,
    intro: "A skill game is one where the better player wins, such as a quiz, a reaction test or a puzzle. GoodBuild can build these as phone-friendly 2D games with a leaderboard, and can charge a G$ entry and pay prizes when play decides the winner.",
    sections: [
      { heading: "What is allowed", paragraphs: ["Games where the winner is decided by play. Games of chance for money and sports betting are not allowed on GoodBuild. If the outcome depends on luck, the idea is out."] },
      { heading: "Design it", bullets: ["The rules and how a score is decided.", "The entry fee and how the prize pool is split.", "A round length, so prizes are paid on time.", "Anti-cheating: scores should be checked, not just sent by the page."] },
      { heading: "Steps", steps: ["Describe the game in [GoodBuild](/), including controls and the scoring rule.", "Try it on a phone-sized preview. Sound starts only after a tap.", "Add the entry fee and prize rule, and test with test tokens.", "Publish and share."] },
      { heading: "Check your local rules", paragraphs: ["Prize games can be regulated, even when skill decides the result. You are responsible for what you run. This isn't legal advice."] },
    ],
    faq: [
      { q: "What counts as a skill game?", a: "One where the better player wins: a quiz, a puzzle, a reaction test. If chance decides the winner, GoodBuild won't build it." },
      { q: "Does the game run on a phone?", a: "GoodBuild's 2D games are built for phones and computers, with touch controls. Test on a real phone before you share it." },
      { q: "How are scores kept honest?", a: "Don't trust a score sent by the page alone. Check scores where the player can't edit them, and say how you decide ties." },
    ],
    related: ["minipay-mini-app-ideas", "mobile-first-web3-app-low-data", "what-is-g-dollar-gooddollar-apps"],
  },
  {
    slug: "build-airdrop-app",
    query: "how to create a token airdrop claim page",
    cluster: "ideas",
    title: "Build a Token Airdrop and Claim Page Without Coding",
    description: "Build an airdrop where eligible wallets claim tokens from a page. Decide the list and limits, generate the contract and test claims before launch.",
    date,
    intro: "An airdrop gives tokens to a list of wallets. A claim page lets each eligible person collect theirs once.",
    sections: [
      { heading: "Decide", bullets: ["Who is eligible and how you know.", "How much each person gets.", "A deadline, and what happens to unclaimed tokens.", "One claim per wallet, enforced in the contract."] },
      { heading: "Steps", steps: ["Prepare the list of eligible wallets.", "Describe the airdrop in [GoodBuild](/) with the numbers.", "Test claims from an eligible wallet, an ineligible one and a repeat claim on Celo Sepolia.", "Fund the contract with the right amount.", "Publish the claim page."] },
      { heading: "Watch out for", bullets: ["Fake accounts claiming many times: tie eligibility to something real.", "Funding more than you can afford to lose until it has been reviewed.", "Scam copies of your page. Share only your official link."] },
    ],
    faq: [
      { q: "What is an airdrop?", a: "A free distribution of tokens to a chosen set of wallets, usually to reward early users or grow a community." },
      { q: "How does the contract know who is eligible?", a: "It can hold a list of wallets, or check a rule such as holding another token. Pick the simplest rule that works." },
      { q: "What if people claim with fake wallets?", a: "Tie eligibility to something that is costly to fake, and cap what each person can get." },
    ],
    related: ["create-erc20-token-no-code", "build-loyalty-rewards-app", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "build-event-ticket-app",
    query: "build an event ticket app blockchain",
    cluster: "ideas",
    title: "Build an Event Ticket App With On-Chain Passes",
    description: "Sell event tickets as passes on Celo: limited seats, one per wallet, a check-in screen at the door. How to plan, build and test it.",
    date,
    intro: "A ticket app sells a limited number of passes and lets staff check them at the door. Putting the pass on a blockchain makes it hard to fake.",
    sections: [
      { heading: "Plan", bullets: ["Number of seats and the price.", "Limit per wallet.", "Refund rules.", "How staff check a pass: scan a QR code, read the wallet."] },
      { heading: "Steps", steps: ["Describe the event and the rules in [GoodBuild](/).", "Test buying, a sold-out event and a double check-in on Celo Sepolia.", "Make a staff check-in page that works on a phone.", "Publish the buying page and share it."] },
      { heading: "Tip", paragraphs: ["People without a wallet are your main loss. If your guests are new, say how to join before the event, and have a helper at the door."] },
      { heading: "Door-day checklist", bullets: ["A charged phone and a backup phone for check-in.", "A printed list of the contract address and your official link, so nobody is sent to a copy.", "A plan for people whose pass won't load: a helper, a name check, and a note to fix it afterwards.", "A short sign saying how to open the pass in the wallet."] },
    ],
    faq: [
      { q: "Can a pass be resold?", a: "Only if you allow transfers. Many events don't, so a ticket stays with the buyer." },
      { q: "How does check-in work?", a: "Staff open a check-in page that confirms the wallet holds a valid pass. Test it with a poor connection, since venues often have one." },
      { q: "What about refunds?", a: "Decide before launch and write it into the rules. A refund window is easy to describe and easy to test." },
    ],
    related: ["create-nft-collection-no-code", "build-loyalty-rewards-app", "minipay-mini-app-ideas"],
  },
];
