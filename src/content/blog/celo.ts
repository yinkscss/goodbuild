import type { Post } from "./types";

const date = "2026-11-10";

export const celoPosts: Post[] = [
  {
    slug: "how-to-build-a-dapp-on-celo",
    query: "how to build a dapp on celo",
    cluster: "celo",
    title: "How to Build a dApp on Celo: A Beginner's Guide",
    description: "Build a dApp on Celo from idea to live link: pick the job, write the contract, test on Celo Sepolia, deploy by signing and publish the front end.",
    date,
    intro: "A dApp on Celo is a website plus a smart contract. This guide walks through the whole path, from the idea to a live link, and shows where an AI builder does the heavy lifting.",
    sections: [
      {
        heading: "The parts of a dApp",
        bullets: [
          "**The contract.** Code that lives on the blockchain and holds the rules and the money.",
          "**The front end.** The website people use. It talks to the contract through a wallet.",
          "**The wallet.** Where the user's keys live. It signs each action.",
        ],
      },
      {
        heading: "Step by step",
        steps: [
          "**Pick one job.** \"Members pay a weekly amount and the pot goes to one member\" is a job.",
          "**Write the rules in plain words.** Who can do what, how much, and when.",
          "**Generate the contract and the screens.** In [GoodBuild](/) you paste the rules; the builder asks questions, then writes both.",
          "**Test on Celo Sepolia.** It is the test network, with free tokens. See [how to deploy on Celo Sepolia](/blog/deploy-smart-contract-celo-sepolia).",
          "**Read what you are about to deploy.** Generated code is not audited. See [is AI-generated code safe](/blog/is-ai-generated-smart-contract-safe).",
          "**Deploy to mainnet by signing.** Your wallet signs and pays the network fee. Nobody else holds your keys.",
          "**Publish the front end.** You get a web address anyone can open.",
        ],
      },
      {
        heading: "Why Celo",
        paragraphs: [
          "Celo fees are low, it works with ordinary EVM tools and Solidity, it is mobile-first, and it has MiniPay, a stablecoin wallet with a built-in app browser. If your users are on phones, that matters. See [what a MiniPay app is](/blog/what-is-a-minipay-app).",
        ],
      },
      {
        heading: "What you still have to decide",
        paragraphs: [
          "An AI builder writes code, not policy. You decide who can withdraw, what the limits are and what happens when something goes wrong. Put those answers in the first prompt and the result will be much closer to what you meant.",
        ],
      },
    ],
    faq: [
      { q: "Do I need to know Solidity?", a: "No, but you should be able to read a plain-language summary of what the contract does. Ask the builder to explain each function." },
      { q: "How much does it cost to deploy?", a: "The network fee on Celo is small and is paid from your own wallet. On Celo Sepolia it costs nothing real because the tokens are test tokens." },
    ],
    related: ["build-a-dapp-without-coding", "deploy-smart-contract-celo-sepolia", "what-is-a-dapp"],
  },
  {
    slug: "build-a-dapp-without-coding",
    query: "build a dapp without coding",
    cluster: "celo",
    title: "Build a dApp Without Coding: What Works in 2026",
    description: "You can build a dApp without coding by describing it to an AI builder. What works, what doesn't, and how to avoid the common mistakes.",
    date,
    intro: "Building a dApp without coding is possible now, as long as you can describe the rules clearly and are willing to test and read what comes out.",
    sections: [
      {
        heading: "What \"no code\" really means",
        paragraphs: [
          "You are not skipping the thinking. You are skipping the typing. The AI writes the Solidity contract and the React front end. You still decide what the app does, test it and take responsibility for it.",
        ],
      },
      {
        heading: "Three ways people do it",
        bullets: [
          "**Visual contract builders.** You pick from templates and fill in fields. Quick, but limited to what the template allows.",
          "**Generic AI app builders.** Great for websites. Many do not write or deploy smart contracts.",
          "**An AI dApp builder.** You describe the app and it writes the contract and the front end together. GoodBuild is one of these, focused on Celo.",
        ],
      },
      {
        heading: "How to get a good result",
        steps: [
          "Describe one job, the people involved and the amounts.",
          "Answer the builder's questions instead of skipping them.",
          "Test every button in the preview.",
          "Deploy to Celo Sepolia first.",
          "Have someone who reads Solidity look at it before real money moves.",
        ],
      },
      {
        heading: "Where it falls short",
        bullets: [
          "Generated contracts are unaudited and can have mistakes that lose funds.",
          "Apps built this way have no separate server behind them for now. Forms and saved data are supported, but not a custom backend.",
          "Games of chance for money and sports betting are not allowed on GoodBuild.",
        ],
      },
      {
        heading: "Try it",
        paragraphs: ["Start with a small idea in [GoodBuild](/). New accounts get 20 credits of AI free, enough for a few small builds."],
      },
    ],
    related: ["how-to-build-a-dapp-on-celo", "best-ai-dapp-builders-for-web3", "no-code-vs-vibe-coding"],
  },
  {
    slug: "what-is-a-dapp",
    query: "what is a dapp",
    cluster: "celo",
    title: "What Is a dApp? A Beginner's Guide With Examples",
    description: "A dApp is an app whose rules run on a blockchain instead of a company's server. What that means, how it differs from a normal app and where to start.",
    date,
    intro: "A dApp, short for decentralized app, is an app whose key rules and money handling run on a blockchain, so no single company can change them behind your back.",
    sections: [
      {
        heading: "A normal app versus a dApp",
        paragraphs: [
          "In a normal app, a company's server decides what is allowed and keeps your balance in its database. In a dApp, a smart contract on a blockchain decides, and your balance sits in your own wallet or in the contract. Anyone can read the contract's code.",
        ],
      },
      {
        heading: "What a dApp is made of",
        bullets: ["A smart contract on a blockchain such as Celo.", "A website or mobile page that talks to it.", "A wallet the user signs with."],
      },
      {
        heading: "Examples",
        bullets: [
          "A savings group where the contract holds and pays out the pot.",
          "A crowdfunder that returns money if the goal is missed.",
          "A voting page where each wallet gets one vote.",
          "A tip jar that sends tips straight to a creator.",
        ],
      },
      {
        heading: "The trade-offs",
        bullets: [
          "**Good:** rules are visible, payments are fast and cheap on Celo, and you don't need a bank account to take part.",
          "**Not so good:** transactions can't be undone, mistakes in a contract can lose money, and users need a wallet.",
        ],
      },
      {
        heading: "How to make one",
        paragraphs: ["You can write one by hand, or describe it to an AI builder. See [how to build a dApp on Celo](/blog/how-to-build-a-dapp-on-celo) or try [GoodBuild](/)."],
      },
    ],
    faq: [{ q: "Is a dApp the same as a crypto app?", a: "Often, yes. The key difference is that the rules run on a blockchain, not just that crypto is involved." }],
    related: ["how-to-build-a-dapp-on-celo", "build-a-dapp-without-coding", "ai-smart-contract-generator"],
  },
  {
    slug: "ai-smart-contract-generator",
    query: "ai smart contract generator",
    cluster: "celo",
    title: "AI Smart Contract Generators: Uses and Limits",
    description: "An AI smart contract generator writes Solidity from a description. What to expect, where it goes wrong, and how to use one without losing money.",
    date,
    intro: "An AI smart contract generator turns a plain description into Solidity code. It is fast and good at common patterns, and it still needs a human to check the result.",
    sections: [
      {
        heading: "What a generator does well",
        bullets: [
          "Standard patterns: tokens, simple vaults, voting, airdrops, payment splits.",
          "Boilerplate and tests you would otherwise type by hand.",
          "Explaining what each function does in plain words.",
        ],
      },
      {
        heading: "Where it goes wrong",
        bullets: [
          "**Subtle logic mistakes.** A function that looks right but lets someone withdraw twice.",
          "**Missing limits.** No cap on an amount, no pause, no way to fix a bug.",
          "**Wrong assumptions.** Guessing a token's decimals, or who the owner is.",
        ],
      },
      {
        heading: "How to use one safely",
        steps: [
          "Describe rules, limits and who can do what, in specific numbers.",
          "Ask the tool to explain each function back to you.",
          "Test on a test network with test tokens.",
          "Try to break it: send zero, send too much, call it twice.",
          "Get a person who knows Solidity to review anything that holds real money.",
        ],
      },
      {
        heading: "How GoodBuild handles it",
        paragraphs: [
          "[GoodBuild](/) asks questions before it writes, writes the contract and the front end together, and you sign the deploy from your own wallet. It never holds your keys. The Terms say plainly that generated contracts are unaudited, and this post says the same thing.",
        ],
      },
    ],
    related: ["is-ai-generated-smart-contract-safe", "how-to-build-a-dapp-on-celo", "learn-solidity-with-ai"],
  },
  {
    slug: "deploy-smart-contract-celo-sepolia",
    query: "deploy smart contract celo sepolia",
    cluster: "celo",
    title: "How to Deploy a Smart Contract on Celo Sepolia",
    description: "Celo Sepolia is the free test network for Celo. How to get test funds, deploy a contract from your own wallet and check it before going to mainnet.",
    date,
    intro: "Celo Sepolia is Celo's test network. Deploying there first costs nothing real and lets you find mistakes before they cost money.",
    sections: [
      {
        heading: "Why test first",
        paragraphs: ["A deployed contract can't be edited. If there is a mistake, you deploy a new one. Doing that on a test network, where tokens are free, is the cheap way to learn."],
      },
      {
        heading: "Steps",
        steps: [
          "Switch your wallet to Celo Sepolia, or let your builder add the network for you.",
          "Get test CELO from a faucet. You paste your wallet address, and the faucet sends free test coins.",
          "Build the contract. In [GoodBuild](/), you describe it and the builder writes it.",
          "Press Deploy and sign in your wallet. Your wallet pays a tiny test fee.",
          "Open the contract's address in a block explorer to see it on the network.",
          "Use the app: try every function, including the ones that should fail.",
        ],
      },
      {
        heading: "Check it",
        bullets: [
          "Is the source code verified on the explorer, so anyone can read it?",
          "Do the owner and settings match what you intended?",
          "Does each function work with a normal amount, zero and a very large amount?",
        ],
      },
      {
        heading: "Then mainnet",
        paragraphs: ["When you are happy, deploy the same contract to Celo mainnet. It uses real money, so GoodBuild shows an extra confirmation naming the network before you sign. Start with small amounts."],
      },
    ],
    related: ["how-to-build-a-dapp-on-celo", "celo-sepolia-faucet-guide", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "celo-sepolia-faucet-guide",
    query: "celo sepolia faucet how to get test celo",
    cluster: "celo",
    title: "Celo Sepolia Faucet: How to Get Free Test CELO",
    description: "How to get free test CELO for Celo Sepolia: copy your wallet address, use a faucet, check the balance and what to do if the funds don't arrive.",
    date,
    intro: "To deploy or use an app on Celo Sepolia you need a little test CELO for fees. A faucet gives it away free.",
    sections: [
      {
        heading: "What test CELO is",
        paragraphs: ["Test CELO has no value. It exists so developers can try things safely. It pays the small fee for each transaction on the test network."],
      },
      {
        heading: "Four steps",
        steps: [
          "Copy your wallet address from your wallet.",
          "Open a Celo Sepolia faucet. Celo's developer documentation lists the current ones.",
          "Paste the address and request funds.",
          "Return to your wallet or app and check the balance. It can take a minute.",
        ],
      },
      {
        heading: "If nothing arrives",
        bullets: [
          "Check that your wallet is on Celo Sepolia, not mainnet.",
          "Wait a few minutes and refresh.",
          "Faucets have limits per address and per day. Try again later, or try another faucet.",
          "Make sure you pasted the full address.",
        ],
      },
      {
        heading: "In GoodBuild",
        paragraphs: ["The deploy window walks you through the same four steps when your balance is empty, so you don't leave the app to find out what to do."],
      },
      {
        heading: "Never send real money to a faucet address",
        paragraphs: ["Faucets give; they do not need your funds. If a site asks you to send CELO to get more back, it is a scam."],
      },
    ],
    related: ["deploy-smart-contract-celo-sepolia", "how-to-build-a-dapp-on-celo", "what-is-a-dapp"],
  },
  {
    slug: "learn-solidity-with-ai",
    query: "learn solidity with ai",
    cluster: "celo",
    title: "Learn Solidity With AI: A Practical Way to Start",
    description: "Learn Solidity by building real contracts with an AI builder: generate, read, change and break them. A practical plan for beginners.",
    date,
    intro: "The fastest way to learn Solidity now is to generate a small contract, read it line by line, change it and try to break it.",
    sections: [
      {
        heading: "A plan that works",
        steps: [
          "Pick a tiny contract: a tip jar, a counter, a simple vote.",
          "Generate it with an AI builder.",
          "Ask for an explanation of every line. Keep asking until it makes sense.",
          "Change one rule, such as a limit, and see what changes.",
          "Deploy it to a test network and use it.",
          "Try to break it: call it twice, send zero, use the wrong account.",
        ],
      },
      {
        heading: "Concepts to learn first",
        bullets: [
          "**State.** The data the contract stores.",
          "**Functions and who may call them.** Access control is where many bugs live.",
          "**Events.** How a contract tells the outside world what happened.",
          "**Value.** How a contract receives and sends tokens.",
          "**Gas.** The fee for running code.",
        ],
      },
      {
        heading: "Use AI as a tutor, not an oracle",
        paragraphs: ["Models are wrong sometimes, and confident when they are. Check claims against the Solidity documentation, and trust a test over an explanation."],
      },
      {
        heading: "Where GoodBuild helps",
        paragraphs: ["Everything you generate in [GoodBuild](/) is visible as code. It is a quick way to see how a real contract and its front end fit together on Celo."],
      },
    ],
    related: ["ai-smart-contract-generator", "is-ai-generated-smart-contract-safe", "deploy-smart-contract-celo-sepolia"],
  },
  {
    slug: "is-ai-generated-smart-contract-safe",
    query: "is ai generated smart contract safe",
    cluster: "celo",
    title: "Is an AI-Generated Smart Contract Safe? An Honest Answer",
    description: "AI-written smart contracts can contain bugs that lose money. What can go wrong, how to test, and when you should pay for a human audit.",
    date,
    intro: "Not by default. An AI-generated smart contract can look right and still hold a bug that loses money, so treat it as a draft that needs checking.",
    sections: [
      {
        heading: "Why contracts are riskier than websites",
        paragraphs: ["A broken website can be fixed in minutes. A deployed contract usually can't be edited, and a transaction can't be undone. A mistake can stay and be exploited."],
      },
      {
        heading: "Common problems",
        bullets: [
          "Anyone can call a function that should be owner-only.",
          "Funds can be withdrawn more than once.",
          "No limits on amounts or rates.",
          "Wrong token decimals, so amounts are off by powers of ten.",
        ],
      },
      {
        heading: "What you can do",
        steps: [
          "Keep the contract as simple as the job allows.",
          "Test on Celo Sepolia, with unusual inputs.",
          "Start on mainnet with small amounts.",
          "Ask the tool to list every way a user could lose money.",
          "For anything that holds other people's money, pay for a human audit.",
        ],
      },
      {
        heading: "What GoodBuild says",
        paragraphs: [
          "GoodBuild's Terms state that contracts it generates are unaudited and that nobody at GoodBuild reviews them. You sign each deploy from your own wallet and are responsible for what you deploy. That is the right way to think about any AI builder, not only this one.",
        ],
      },
    ],
    faq: [{ q: "Can an AI audit its own contract?", a: "It can find some mistakes, but a model checking its own work shares its blind spots. Use tests and a human reviewer too." }],
    related: ["ai-smart-contract-generator", "vibe-coding-web3-risks", "deploy-smart-contract-celo-sepolia"],
  },
  {
    slug: "create-erc20-token-no-code",
    query: "create erc20 token without coding",
    cluster: "celo",
    title: "How to Create an ERC-20 Token Without Coding",
    description: "Create your own ERC-20 token on Celo without code: choose supply and name, generate the contract, test it and deploy by signing from your wallet.",
    date,
    intro: "An ERC-20 token is the standard format for a coin on Ethereum-style networks such as Celo. You can make one by describing it, without writing the contract.",
    sections: [
      {
        heading: "Decide these first",
        bullets: [
          "**Name and symbol.** For example, \"Class Credit\" and \"CLS\".",
          "**Total supply.** A fixed number, or can more be minted later, and by whom?",
          "**Who gets it at the start.**",
          "**What it is for.** A token with no use is a number.",
        ],
      },
      {
        heading: "Steps",
        steps: [
          "Describe the token in [GoodBuild](/), including supply and who controls minting.",
          "Review the contract the builder shows you.",
          "Deploy to Celo Sepolia and send some to a second wallet.",
          "Deploy to mainnet by signing.",
          "Build a small page around it: a balance view or a claim button.",
        ],
      },
      {
        heading: "Things to think about",
        bullets: [
          "Tokens that look like investments can raise legal questions. GoodBuild is for people 18 and over, not available to US persons, and you are responsible for what you launch.",
          "A token that holds other people's money is risky. Get a human review.",
          "Say clearly what the token is and isn't.",
        ],
      },
    ],
    faq: [
      { q: "What does ERC-20 mean?", a: "It is a shared standard for tokens, so wallets, apps and exchanges all know how to read balances and send the coin. Celo follows the same standard as Ethereum." },
      { q: "Can I change the supply after launch?", a: "Only if the contract was written to allow it, and only by whoever it names. Decide this before you deploy, because the contract itself usually can't be edited afterwards." },
      { q: "Is my own token the same as G$?", a: "No. G$ is the GoodDollar token. Your token is a separate coin with its own contract and its own rules. Your apps can still accept G$ as payment." },
    ],
    related: ["build-airdrop-app", "is-ai-generated-smart-contract-safe", "what-is-a-dapp"],
  },
  {
    slug: "create-nft-collection-no-code",
    query: "create nft collection no code",
    cluster: "celo",
    title: "Create an NFT Collection Without Code on Celo",
    description: "How to launch an NFT collection without writing code: plan the art and supply, generate the contract and mint page, test and deploy on Celo.",
    date,
    intro: "An NFT collection is a set of unique tokens, each pointing to a piece of art or a pass. A builder can write the contract and the mint page from a description.",
    sections: [
      {
        heading: "What to plan",
        bullets: [
          "The number of items and the price, if any.",
          "Where the images live. They need a stable address.",
          "Who can mint, and how many each.",
          "What owning one gives, such as access or a badge.",
        ],
      },
      {
        heading: "Steps",
        steps: [
          "Prepare your images and names.",
          "Describe the collection in [GoodBuild](/): supply, price, limit per wallet.",
          "Preview the mint page and test it on Celo Sepolia.",
          "Deploy to mainnet by signing from your wallet.",
          "Publish the page and share the link.",
        ],
      },
      {
        heading: "Tips",
        bullets: [
          "Passes and tickets are a more useful start than pictures alone.",
          "Cap the supply and per-wallet limit in the contract, not only on the page.",
          "Test minting with several wallets.",
        ],
      },
    ],
    faq: [
      { q: "Where are the images stored?", a: "Usually not on the blockchain itself, which would be costly. The token points to an image kept at a stable web address. Pick a home that will still be there in five years." },
      { q: "Can I limit how many one person mints?", a: "Yes, but put the limit in the contract. A limit that only exists on the web page can be bypassed by calling the contract directly." },
      { q: "Do NFTs have to be art?", a: "No. Tickets, membership passes and badges are often more useful than pictures, because owning one gives the holder something to do." },
    ],
    related: ["create-erc20-token-no-code", "build-event-ticket-app", "how-to-build-a-dapp-on-celo"],
  },
  {
    slug: "build-dao-voting-app-no-code",
    query: "build a dao voting app",
    cluster: "celo",
    title: "Build a DAO Voting App Without Writing Code",
    description: "Build a DAO voting app where each member gets a vote: define who can vote, how proposals pass, then generate, test and publish it on Celo.",
    date,
    intro: "A DAO voting app lets a group make decisions with votes that nobody can alter afterwards. The hard part is the rules, which you can write in plain words.",
    sections: [
      {
        heading: "Rules to decide",
        bullets: [
          "**Who votes.** One wallet, one vote, or weighted by a token?",
          "**Who can propose.**",
          "**How long a vote runs.**",
          "**What passes it.** A simple majority, or a minimum turnout too.",
          "**What happens after.** The app records the result, or it moves money.",
        ],
      },
      {
        heading: "Steps",
        steps: [
          "Write the rules in one paragraph.",
          "Paste them into [GoodBuild](/) and answer its questions.",
          "Test with three wallets: one that should pass, one that should fail, one that tries to vote twice.",
          "Deploy and publish.",
        ],
      },
      {
        heading: "Pitfalls",
        bullets: [
          "Sybil votes: one person creating many wallets. If it matters, tie votes to something like a verified identity or a token held for some time.",
          "Contracts that move money after a vote hold other people's funds. Get a human review.",
        ],
      },
    ],
    faq: [
      { q: "What does DAO stand for?", a: "Decentralized autonomous organization. In practice it is a group whose decisions are recorded by a smart contract that counts votes, so the tally can't be quietly changed." },
      { q: "Can a vote move money automatically?", a: "It can, if the contract is written that way. That makes the contract hold funds, so test it carefully and get a human review before using real money." },
      { q: "How do I stop one person voting many times?", a: "A plain wallet vote can't. Tie voting power to something harder to fake, such as holding a token for a period, or a verified identity." },
    ],
    related: ["create-erc20-token-no-code", "build-crowdfunding-dapp", "is-ai-generated-smart-contract-safe"],
  },
  {
    slug: "web3-front-end-wallet-connect",
    query: "web3 front end wallet connect react",
    cluster: "celo",
    title: "Web3 Front Ends: Connecting Wallets in a React App",
    description: "How a React web3 front end connects wallets: browser wallets, WalletConnect on phones, MiniPay, and what an AI builder handles for you.",
    date,
    intro: "The front end of a dApp has one awkward job: reaching the user's wallet. It has to work with browser extensions, phone wallets and built-in wallets like MiniPay.",
    sections: [
      {
        heading: "The cases",
        bullets: [
          "**A browser extension wallet.** The page finds it and asks to connect.",
          "**A phone wallet.** WalletConnect shows a QR code on a computer, or opens the wallet app on a phone.",
          "**A built-in wallet.** MiniPay connects on page load with no list.",
        ],
      },
      {
        heading: "What a good wallet layer does",
        bullets: [
          "Lists every wallet the browser has.",
          "Remembers the choice and reconnects on reload.",
          "Names the network and says when it is the wrong one.",
          "Shows amount and recipient before each signature.",
          "Says what to do when no wallet exists.",
        ],
      },
      {
        heading: "What GoodBuild does",
        paragraphs: [
          "Apps published by [GoodBuild](/) get its own wallet layer: a wallet list, a MiniPay auto-connect and, when the owner has set it up, WalletConnect. Some parts, such as phone deep links and a MiniPay session, are not yet confirmed on every real device, so test on your own phone before you share a link.",
        ],
      },
    ],
    faq: [
      { q: "What is WalletConnect?", a: "A protocol that links a website to a wallet on your phone. On a computer you scan a QR code; on a phone the page opens the wallet app directly." },
      { q: "Why does my dApp need a network check?", a: "A wallet can be on the wrong network. The page should say so and offer to switch, so the user doesn't sign something on a chain you didn't mean." },
      { q: "Do I write this code myself?", a: "Not with an AI builder. It adds a wallet layer for you, and you check it on your own devices." },
    ],
    related: ["what-is-a-minipay-app", "mobile-first-web3-app-low-data", "how-to-build-a-dapp-on-celo"],
  },
];
