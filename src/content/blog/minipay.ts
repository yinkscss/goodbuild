import type { Post } from "./types";

const date = "2026-11-10";

export const minipayPosts: Post[] = [
  {
    slug: "what-is-a-minipay-app",
    query: "what is a minipay app",
    cluster: "minipay",
    title: "What Is a MiniPay App? A Plain-English Guide",
    description: "A MiniPay app is a small web app that opens inside the MiniPay wallet and moves stablecoins on Celo. Here is what one is and how it differs from a normal app.",
    date,
    intro: "A MiniPay app is a small web app that opens inside the MiniPay wallet, so people can pay, save or sign up without installing anything else or connecting a wallet by hand.",
    sections: [
      {
        heading: "The short version",
        paragraphs: [
          "MiniPay is a stablecoin wallet built on the Celo network. It has a built-in browser and a Discover page where small apps live. A mini app is an ordinary website, written in HTML, CSS and JavaScript, that knows it is running inside MiniPay and talks to the wallet around it.",
          "Because the wallet is already there, the app skips the part that loses most visitors: finding a wallet, installing it and pressing connect. The user is already signed in.",
        ],
      },
      {
        heading: "What makes a MiniPay app different from a website",
        bullets: [
          "**The wallet is built in.** The page finds the wallet in the browser and connects on load.",
          "**Fees can be paid in stablecoins.** Celo lets a transaction pay its network fee in a stablecoin instead of CELO, so users don't need a second token.",
          "**It has to work on a phone.** Most MiniPay users are on small screens and mobile data, so a heavy page is a bad page.",
          "**Payments are the point.** Mini apps are usually about money: sending, splitting, saving, paying a bill or joining a group.",
        ],
      },
      {
        heading: "What kinds of MiniPay apps exist",
        paragraphs: [
          "Typical ones are payment links, tip jars, savings groups, small shops, ticketing and rewards. A good mini app does one job well in three taps. See [MiniPay mini app ideas](/blog/minipay-mini-app-ideas) for a longer list.",
        ],
      },
      {
        heading: "Do you need to be a developer?",
        paragraphs: [
          "Not any more. You describe the app in everyday words and an AI builder writes the code. [GoodBuild](/) builds the front end and, if the idea needs one, a smart contract, then publishes the result to its own web address. Published apps are built to connect on their own inside MiniPay. We haven't yet confirmed that on a real MiniPay phone, so open your app inside MiniPay yourself before you share it. The steps are in [how to test a MiniPay app](/blog/test-minipay-app-developer-mode).",
        ],
      },
    ],
    faq: [
      { q: "Is a MiniPay app the same as a dApp?", a: "Mostly. A dApp is any app that talks to a blockchain. A MiniPay app is a dApp designed to open inside the MiniPay wallet on Celo." },
      { q: "Does a MiniPay app need its own wallet screen?", a: "No. Inside MiniPay the wallet connects by itself, so the app can skip the connect-wallet list." },
    ],
    related: ["build-minipay-app-without-coding", "minipay-mini-app-ideas", "minipay-dapp-development-basics"],
  },
  {
    slug: "build-minipay-app-without-coding",
    query: "build a minipay app without coding",
    cluster: "minipay",
    title: "How to Build a MiniPay App Without Coding",
    description: "Describe your MiniPay app in plain words, preview it, and publish it to a link you can open inside MiniPay. A step-by-step guide that needs no code.",
    date,
    intro: "You can build a MiniPay app without writing code: describe what it should do, check the preview, then publish it to a web address and open that address inside MiniPay.",
    sections: [
      {
        heading: "Before you start",
        bullets: [
          "Decide on one job for the app. \"Collect a small fee for a class\" is a job. \"A fintech super-app\" is not.",
          "Know who pays and who receives. Most mistakes in payment apps come from fuzzy answers here.",
          "Be 18 or over. GoodBuild is not available to US persons.",
        ],
      },
      {
        heading: "The steps",
        steps: [
          "Open [GoodBuild](/) and write your idea in the prompt box. Include who uses it, what they do and what amount moves. For example: \"A page where anyone can pay 2 dollars in a stablecoin to join my weekly class, and I see a list of who paid.\"",
          "Sign in with email or a wallet. Your prompt is kept while you do.",
          "Answer the short questions the builder asks before it starts. They catch the gaps in your idea.",
          "Watch the build, then try the app in the preview. Ask for changes in the chat: \"make the pay button bigger\", \"show amounts with two decimals\".",
          "If the idea needs a smart contract, deploy it by signing from your own wallet. GoodBuild never holds your keys. Try it on the Celo Sepolia test network first, where the tokens have no value.",
          "Publish. Your app gets its own address, like your-app.goodbuildit.xyz.",
          "Open that address inside MiniPay and try a payment yourself.",
        ],
      },
      {
        heading: "What to ask the builder for",
        paragraphs: [
          "Mobile-first layout, big buttons, short text and a clear amount before any payment are what make a mini app feel right. Say so in your prompt. Also say what should happen when something fails, such as a payment that is rejected.",
        ],
      },
      {
        heading: "What to check before you share it",
        bullets: [
          "Open the published link inside MiniPay and confirm it connects without a wallet list. GoodBuild apps are built to do this but it has not been confirmed on a real MiniPay yet.",
          "Generated contracts are not audited. Test with small amounts, and have a developer read the contract before real money flows through it.",
        ],
      },
    ],
    faq: [
      { q: "How much does it cost?", a: "New GoodBuild accounts get 20 credits of AI free, which covers a few small builds. Afterwards you pay the AI cost plus 25%. Network fees for deploys go to the network." },
      { q: "Can I build a MiniPay app for free?", a: "You can build and try one using the free starting credit. See [the free AI builder guide](/blog/free-ai-app-builder) for what that covers." },
    ],
    related: ["what-is-a-minipay-app", "test-minipay-app-developer-mode", "free-ai-app-builder"],
  },
  {
    slug: "minipay-mini-app-ideas",
    query: "minipay mini app ideas",
    cluster: "minipay",
    title: "15 MiniPay Mini App Ideas You Can Build Today",
    description: "Fifteen practical MiniPay mini app ideas, from tip jars to savings circles, each small enough to describe in one paragraph and build with AI.",
    date,
    intro: "The best MiniPay mini apps do one thing in a few taps. Here are fifteen ideas small enough to describe in a paragraph and build with an AI builder.",
    sections: [
      {
        heading: "Payments and money",
        bullets: [
          "**Payment link page.** One address anyone can open to pay you a fixed amount. See [the invoice app guide](/blog/build-invoice-payment-link-app).",
          "**Tip jar.** A page for a creator, a musician or a market trader. See [how to build a tipping app](/blog/build-tipping-app-g-dollar).",
          "**Bill splitter.** Enter the total, add friends, and each person pays their share.",
          "**Savings circle.** A rotating pot that a group fills every week. See [the savings circle guide](/blog/build-savings-circle-app).",
          "**Pay-what-you-want shop.** A tiny store with a few products and a stablecoin checkout.",
        ],
      },
      {
        heading: "Community and groups",
        bullets: [
          "**Fundraiser.** A goal, a progress bar and a list of donors. See [the crowdfunding guide](/blog/build-crowdfunding-dapp).",
          "**Membership pass.** Pay once, show a pass at the door.",
          "**Class or event tickets.** Sell a fixed number of seats, one per wallet.",
          "**Community vote.** One wallet, one vote, a clear result. See [the DAO voting guide](/blog/build-dao-voting-app-no-code).",
          "**Neighbourhood rewards.** Points for a local shop that people can spend later.",
        ],
      },
      {
        heading: "Games and fun",
        bullets: [
          "**Quick skill game with a best-score board.** Winning depends on play, not luck.",
          "**Quiz night with a prize pool.** The winner is the highest score. See [skill games with an entry fee](/blog/build-skill-game-with-entry-fee).",
          "**Daily puzzle streak.** A reward after seven days in a row.",
          "**Trivia for a community.** One question a day, a leaderboard on Friday.",
        ],
      },
      {
        heading: "How to pick one",
        paragraphs: [
          "Choose the idea where you already know the users. A mini app for a group you belong to gets its first fifty users from you, which matters more than any feature. Then write it down as one paragraph and put it in [GoodBuild](/).",
          "A note on what is out of scope: GoodBuild does not build sports betting or games of chance for money, so skip any idea that depends on luck.",
        ],
      },
    ],
    related: ["build-minipay-app-without-coding", "what-is-a-minipay-app", "build-savings-circle-app"],
  },
  {
    slug: "minipay-dapp-development-basics",
    query: "minipay dapp development",
    cluster: "minipay",
    title: "MiniPay dApp Development: What Is Different on Celo",
    description: "What changes when your dApp runs inside MiniPay: auto-connect, stablecoin fees, small screens and Celo networks. A short checklist for builders.",
    date,
    intro: "A dApp that runs inside MiniPay behaves differently from one in a desktop browser. Five things change: how the wallet connects, how fees are paid, the screen, the network and how you test.",
    sections: [
      {
        heading: "1. The wallet connects by itself",
        paragraphs: [
          "MiniPay exposes a wallet to the page and marks it as MiniPay. A dApp should detect that and connect on load, with no connect button and no list of wallets. Outside MiniPay, show the normal wallet list.",
        ],
      },
      {
        heading: "2. Fees can be paid in stablecoins",
        paragraphs: [
          "Celo supports paying the network fee in a stablecoin. Libraries like viem and wagmi handle this, and MiniPay's own docs recommend them. If you hand-write transaction code, check that it does not assume the fee is paid in CELO.",
        ],
      },
      {
        heading: "3. Small screens and slow data",
        bullets: [
          "Keep the page light. No big images, no heavy libraries you don't use.",
          "Put the main action where a thumb reaches it.",
          "Show the exact amount and the recipient before the user signs.",
        ],
      },
      {
        heading: "4. Two networks",
        paragraphs: [
          "Celo mainnet uses real money. Celo Sepolia is the test network with tokens that have no value. Build and test on Sepolia first, then move to mainnet when you trust the app.",
        ],
      },
      {
        heading: "5. Testing inside the wallet",
        paragraphs: [
          "MiniPay has a developer mode that loads a page by its web address. Steps are in [how to test a MiniPay app](/blog/test-minipay-app-developer-mode).",
        ],
      },
      {
        heading: "Where an AI builder helps",
        paragraphs: [
          "All of the above is repetitive plumbing. [GoodBuild](/) writes it for you: a wallet layer that connects on its own inside MiniPay and shows a wallet list elsewhere, the contract, and the screens. You still own the decisions: what the app charges, who can withdraw and what happens when it fails.",
        ],
      },
    ],
    related: ["what-is-a-minipay-app", "test-minipay-app-developer-mode", "how-to-build-a-dapp-on-celo"],
  },
  {
    slug: "stablecoin-payment-app-celo",
    query: "stablecoin payment app on celo",
    cluster: "minipay",
    title: "How to Build a Stablecoin Payment App on Celo",
    description: "Build a stablecoin payment app on Celo: who pays whom, what the contract does, how fees work and what to test before real money moves.",
    date,
    intro: "A stablecoin payment app lets one person pay another in a coin that holds its value, with the rules enforced by a smart contract on Celo rather than by a company.",
    sections: [
      {
        heading: "Why stablecoins for payments",
        paragraphs: [
          "A price that does not swing makes a good payment. A seller wants to know that 5 dollars of value on Monday is still about 5 dollars on Friday. Celo is built around mobile payments and supports stablecoins natively, which is why MiniPay lives there.",
        ],
      },
      {
        heading: "Decide the money flow first",
        bullets: [
          "Who pays, who receives, and in which token?",
          "Is the amount fixed or chosen by the payer?",
          "Does the money go straight to the receiver, or wait in a contract until a condition is met?",
          "Can anything be refunded, and by whom?",
        ],
      },
      {
        heading: "Direct payment or contract?",
        paragraphs: [
          "A simple payment link needs no custom contract: the app asks the wallet to send tokens straight to you. A contract is worth it when money has to wait, be split or be released by a rule, as in an [escrow](/blog/build-escrow-app-no-code) or a savings group.",
        ],
      },
      {
        heading: "Build it",
        steps: [
          "Write the money flow as a paragraph. Name the token and the amounts.",
          "Paste it into [GoodBuild](/) and answer the clarifying questions.",
          "Try it on Celo Sepolia, where tokens are free test coins.",
          "Read the contract, or ask a developer to. Generated contracts are not audited.",
          "Move to mainnet with small amounts first.",
        ],
      },
      {
        heading: "Mistakes to avoid",
        bullets: [
          "Not showing the amount and recipient before signing.",
          "Assuming the user holds CELO for fees.",
          "Letting one wallet set the price with no limit.",
        ],
      },
    ],
    related: ["minipay-dapp-development-basics", "build-invoice-payment-link-app", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "test-minipay-app-developer-mode",
    query: "test minipay app developer mode",
    cluster: "minipay",
    title: "How to Test Your App Inside MiniPay (Developer Mode)",
    description: "Open your own web app inside MiniPay with developer mode and the test page, on Celo Sepolia, before you share it with anyone.",
    date,
    intro: "You can load your own web app inside MiniPay using its developer settings, which is the only reliable way to see how it behaves in the wallet people will use.",
    sections: [
      {
        heading: "What you need",
        bullets: [
          "The MiniPay app on a phone.",
          "A public https address for your app. A GoodBuild published app already has one, like your-app.goodbuildit.xyz.",
          "A little test CELO and a test stablecoin on Celo Sepolia if your app sends money.",
        ],
      },
      {
        heading: "Steps",
        steps: [
          "In MiniPay, open Settings, then Developer Settings.",
          "Turn on Developer Mode. To use the test network, also turn on Use Testnet.",
          "Choose Load Test Page, type your app's https address and tap Go.",
          "Your app opens inside the wallet. Try the main action end to end.",
        ],
      },
      {
        heading: "What to look for",
        bullets: [
          "Does the wallet connect with no list of wallets?",
          "Is every button reachable with a thumb, and is the text readable?",
          "Does the amount shown before signing match the amount sent?",
          "What happens when you reject the transaction?",
          "Does the page load fast on a weak connection?",
        ],
      },
      {
        heading: "Working on your computer",
        paragraphs: [
          "If you are running the app on your own machine, you need an https tunnel so the phone can reach it. Tools like ngrok do this. If you use GoodBuild, publishing gives you the address directly. Update the app, publish again and reload the page in MiniPay.",
        ],
      },
      {
        heading: "An honest note",
        paragraphs: [
          "MiniPay's menus change between versions, so if a label differs, look for the developer or test options. GoodBuild's published apps are built to auto-connect in MiniPay, and this is exactly the check that confirms it for your app.",
        ],
      },
    ],
    related: ["build-minipay-app-without-coding", "minipay-dapp-development-basics", "get-listed-on-minipay-discover"],
  },
  {
    slug: "get-listed-on-minipay-discover",
    query: "get app listed on minipay discover page",
    cluster: "minipay",
    title: "How to Get Your App Listed on MiniPay Discover",
    description: "What the MiniPay Discover page is, what you have to submit to be listed and how to get your app ready, from a working link to a clear icon and tagline.",
    date,
    intro: "MiniPay's Discover page is where users find mini apps. To be listed you submit your app through a form, so the work is mostly getting the app and its details ready.",
    sections: [
      {
        heading: "What the submission asks for",
        paragraphs: ["According to Celo's MiniPay documentation, the form asks for details like these. Check the current form, because it can change:"],
        bullets: ["App name and a short tagline.", "Publisher name.", "A support URL.", "A category.", "The app's web address.", "An icon."],
      },
      {
        heading: "Get the app ready first",
        bullets: [
          "**It works in MiniPay.** Test it with [developer mode](/blog/test-minipay-app-developer-mode).",
          "**It is on mainnet.** Real users use real money, so deploy to Celo mainnet only after Sepolia testing.",
          "**It is honest.** Say what the app does and who runs it. A clear support page builds trust.",
          "**It is light.** Small page, fast load.",
        ],
      },
      {
        heading: "Write the tagline and pick the icon",
        paragraphs: [
          "A tagline should say the job in under eight words: \"Split dinner bills in two taps.\" The icon should read at a small size, so use one shape and two colours, not a detailed picture.",
        ],
      },
      {
        heading: "Your support page",
        paragraphs: [
          "A support address is required, so decide who answers it. For a payments app, someone will eventually write to you about a missing payment. Have a plain answer ready.",
        ],
      },
      {
        heading: "Where GoodBuild fits",
        paragraphs: [
          "[GoodBuild](/) builds and publishes the app to its own address, which you can then use as the app web address in the form. Listing is decided by MiniPay, not by GoodBuild.",
        ],
      },
    ],
    related: ["test-minipay-app-developer-mode", "what-is-a-minipay-app", "stablecoin-payment-app-celo"],
  },
  {
    slug: "mobile-first-web3-app-low-data",
    query: "mobile first web3 app low data",
    cluster: "minipay",
    title: "Mobile-First Web3 Apps: Build for Phones and Low Data",
    description: "Most people reach web3 on a phone with limited data. How to design and build a blockchain app that loads fast, reads clearly and works on small screens.",
    date,
    intro: "For a large part of the world, the first computer is a phone on a limited data plan. A web3 app built for that person looks different from one built for a developer's laptop.",
    sections: [
      {
        heading: "Design rules",
        bullets: [
          "**One main action per screen.** The thing the user came to do, large and reachable with a thumb.",
          "**Plain words.** Say \"send\" and \"balance\", not \"transact\" and \"on-chain state\".",
          "**Show money clearly.** Amount, token and recipient before every signature.",
          "**Big tap targets.** At least 44 pixels high.",
        ],
      },
      {
        heading: "Performance rules",
        bullets: [
          "Keep the page small. Every library is a cost the user pays in data.",
          "Avoid autoplay video and large photos.",
          "Show something useful before the chain data arrives, then fill it in.",
          "Cache what does not change.",
        ],
      },
      {
        heading: "Wallet rules",
        bullets: [
          "Inside a wallet's own browser, like MiniPay, connect without asking.",
          "In a normal phone browser, offer the wallet apps people actually have, and a WalletConnect option.",
          "Say what to do if no wallet is found.",
        ],
      },
      {
        heading: "Games and phones",
        paragraphs: [
          "Games are a good test. They need to run smoothly with touch controls and make sound only after a tap. GoodBuild's 2D game kit builds canvas games without a heavy game engine for this reason: a few kilobytes, not megabytes.",
        ],
      },
      {
        heading: "Ask the builder for it",
        paragraphs: [
          "When you describe your app in [GoodBuild](/), say \"phone first\" and name the one action. Then open the preview at phone width and judge it with your thumb, not your mouse.",
        ],
      },
    ],
    related: ["what-is-a-minipay-app", "minipay-dapp-development-basics", "vibe-coding-prompt-tips"],
  },
];
