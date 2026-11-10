import type { Post } from "./types";

const date = "2026-11-10";

export const freePosts: Post[] = [
  {
    slug: "free-ai-app-builder",
    query: "free ai app builder",
    cluster: "free",
    title: "Free AI App Builder: What You Really Get for $0",
    description: "A free AI app builder lets you try before you pay, but free has limits. What GoodBuild's free start covers, what it doesn't and how to make it go far.",
    date,
    intro: "Most free AI app builders give you a small starting allowance, not unlimited builds. Here is what free means in practice, using GoodBuild's own numbers.",
    sections: [
      {
        heading: "What free means at GoodBuild",
        paragraphs: [
          "Every new account gets $0.20 of AI free during the testnet beta. That covers a few small builds or one larger one. After the beta you pay the actual AI cost of each build plus 25%, and you see an estimate before each build, so the cost is never a surprise.",
          "So it is free to try, not unlimited. We say that plainly because a lot of \"free\" pages don't.",
        ],
      },
      {
        heading: "What else costs nothing",
        bullets: [
          "Signing up with email or a wallet.",
          "Building and previewing in the browser.",
          "Deploying to Celo Sepolia, the test network, where the tokens have no value. Test CELO comes free from a faucet.",
        ],
      },
      {
        heading: "What costs money",
        bullets: [
          "AI builds beyond your free allowance.",
          "The network fee on Celo mainnet, paid from your own wallet to the network, not to GoodBuild.",
        ],
      },
      {
        heading: "Make the free allowance last",
        steps: [
          "Write one clear goal. Vague prompts cause rebuilds.",
          "Answer the builder's questions before it starts building.",
          "Ask for one change at a time.",
          "Use the preview to find problems before you ask for fixes.",
          "Start from a template if one is close to your idea.",
        ],
      },
      {
        heading: "Who can use it",
        paragraphs: ["You must be 18 or over, and GoodBuild is not available to US persons. Sports betting and games of chance for money are not allowed. Start at [GoodBuild](/)."],
      },
    ],
    faq: [
      { q: "Do I need a credit card?", a: "Signing in uses email or a wallet, and the free allowance involves no payment. If you want more later, credits are added from the Add credits screen." },
      { q: "Is the free credit enough to build an app?", a: "It covers a few small builds or one larger one. A build shows an estimate first, so you can see what it will use." },
    ],
    related: ["how-much-does-an-ai-app-builder-cost", "free-ai-website-builder", "build-an-app-with-ai-no-coding-experience"],
  },
  {
    slug: "free-ai-website-builder",
    query: "free ai website builder",
    cluster: "free",
    title: "Free AI Website Builder: Make a Site From One Prompt",
    description: "Build a website from a prompt for free: what to write, how to preview, publish to a live link and add payments or a contact form without code.",
    date,
    intro: "You can build a website by describing it, and start for free. This guide shows how, and how to avoid the usual \"generic template\" look.",
    sections: [
      {
        heading: "A prompt that works",
        paragraphs: ["Say who the site is for, what they should do and what the tone is. \"A one-page site for my bakery in Lagos with a menu, opening hours and a form to order a cake for Saturday\" will do much better than \"a bakery website\"."],
      },
      {
        heading: "Steps",
        steps: [
          "Open [GoodBuild](/) and write your prompt, or pick a template. There are over forty landing-page templates.",
          "Answer the short questions.",
          "Check the preview on a phone-sized window.",
          "Ask for changes in the chat.",
          "Publish. Your site goes live at its own address, your-name.goodbuildit.xyz.",
        ],
      },
      {
        heading: "What a site can do here",
        bullets: [
          "Contact and booking forms that work without the visitor connecting a wallet. You read what they send in the Backend window.",
          "Payments in G$ or stablecoins on Celo.",
          "A game or a small tool on the page.",
        ],
      },
      {
        heading: "What it can't do yet",
        paragraphs: ["There is no separate server of your own behind the sites. If you need user accounts with passwords or a custom database, a general website builder is a better fit."],
      },
      {
        heading: "The cost",
        paragraphs: ["New accounts get $0.20 of AI free during the beta. See [what free really means](/blog/free-ai-app-builder)."],
      },
    ],
    related: ["free-ai-app-builder", "best-ai-website-builders", "vibe-coding-prompt-tips"],
  },
  {
    slug: "build-an-app-with-ai-no-coding-experience",
    query: "how to build an app with ai with no coding experience",
    cluster: "free",
    title: "How to Build an App With AI and No Coding Experience",
    description: "A step-by-step plan for building your first app with AI when you have never coded: pick an idea, write the prompt, test, fix and publish.",
    date,
    intro: "You don't need to learn to code to build an app with AI. You do need to be clear about what you want, and to test what you get.",
    sections: [
      { heading: "1. Choose a small idea", paragraphs: ["Pick something you could explain to a friend in two sentences. A first app should do one thing."] },
      { heading: "2. Write the idea as a paragraph", bullets: ["Who uses it?", "What do they do, step by step?", "If money is involved, how much and to whom?", "What should it look like on a phone?"] },
      {
        heading: "3. Build, test, adjust",
        steps: [
          "Put the paragraph into [GoodBuild](/).",
          "Answer the questions it asks.",
          "Click every button in the preview.",
          "Write down what is wrong in plain words and send it as a message.",
          "Repeat until it does what you meant.",
        ],
      },
      { heading: "4. Show real people", paragraphs: ["Send the published link to three people and watch what they tap. You'll learn more in five minutes than in an hour of tweaking."] },
      { heading: "5. Know the limits", bullets: ["If the app handles money, have someone check it. Generated contracts are unaudited.", "Test networks first, real money later.", "You must be 18 or over to use GoodBuild."] },
    ],
    faq: [
      { q: "How long does a first app take?", a: "A small app can take an afternoon. Most of the time goes on deciding what it should do, not on building it." },
      { q: "What if the result isn't what I wanted?", a: "Say what is wrong in plain words and send it as a message. Describe the problem you see rather than guessing at the fix." },
      { q: "Can I read the code later?", a: "Yes. GoodBuild keeps the code visible, so you can read it, or show it to a developer." },
    ],
    related: ["free-ai-app-builder", "vibe-coding-prompt-tips", "idea-to-app-in-a-weekend"],
  },
  {
    slug: "no-code-vs-vibe-coding",
    query: "no code vs vibe coding",
    cluster: "free",
    title: "No-Code vs Vibe Coding: What Is the Difference?",
    description: "No-code uses visual blocks and templates; vibe coding uses AI that writes real code from your description. How they differ and which one to pick.",
    date,
    intro: "No-code builds apps by arranging pre-made blocks. Vibe coding builds apps by describing them to an AI that writes real code. The result feels similar; the trade-offs aren't.",
    sections: [
      {
        heading: "No-code",
        bullets: ["You drag blocks and fill in fields.", "It is predictable: you can only do what the blocks allow.", "The app usually lives on the tool's platform."],
      },
      {
        heading: "Vibe coding",
        bullets: ["You describe, and the AI writes code.", "It is flexible: you can ask for almost anything.", "It is less predictable: the AI can get things wrong, so you test."],
      },
      {
        heading: "Which to pick",
        bullets: ["A form, a table or a portal: no-code is fine.", "Something unusual, such as a game or a blockchain app: vibe coding.", "Money on a blockchain: vibe coding with a review before real funds."],
      },
      { heading: "Where GoodBuild sits", paragraphs: ["[GoodBuild](/) is on the vibe-coding side: it writes a real contract and a real React front end that you can read. Read [what vibe coding is](/blog/what-is-vibe-coding) for more."] },
    ],
    faq: [
      { q: "Is vibe coding harder than no-code?", a: "It is more open, so you need to describe things clearly and test the result. For beginners it often feels easier, because you just write what you want." },
      { q: "Can I switch from one to the other?", a: "Yes. They can share a project's goals, though the work is not portable between tools." },
      { q: "Which is safer?", a: "Neither is automatically safe. Block-based tools limit what can go wrong; AI-written code needs more testing and review, especially if it handles money." },
    ],
    related: ["what-is-vibe-coding", "best-no-code-app-builders", "build-a-dapp-without-coding"],
  },
  {
    slug: "ai-app-builder-for-students",
    query: "ai app builder for students",
    cluster: "free",
    title: "AI App Builders for Students: Build a Project for Free",
    description: "Students 18 and over can build a real app or dApp for a class project or portfolio with a free AI builder. How to pick a project and what to avoid.",
    date,
    intro: "An app you built yourself is a stronger portfolio piece than an essay about apps. AI builders make it possible in an afternoon, even if you are just starting to code.",
    sections: [
      { heading: "A note on age", paragraphs: ["GoodBuild is for people aged 18 and over, and isn't available to US persons. If that doesn't describe you, a general builder may suit you better."] },
      { heading: "Project ideas", bullets: ["A study-group savings pot that collects a small amount each week.", "A voting page for a class election.", "A club membership pass.", "A quiz game with a best-score board.", "A fundraiser for a campus event."] },
      { heading: "Make it count", steps: ["Write the problem and who has it.", "Build it and put it in front of ten classmates.", "Write down what changed after their feedback.", "Add a short summary to your portfolio: the problem, what you built and what you learned."] },
      { heading: "Learn from it", paragraphs: ["Ask the builder to explain what it wrote. Reading a real contract and a real React app is an education in itself. See [learn Solidity with AI](/blog/learn-solidity-with-ai)."] },
      { heading: "Cost", paragraphs: ["Start with the free allowance: $0.20 of AI for new accounts during the beta. Test on Celo Sepolia where nothing costs real money."] },
    ],
    related: ["learn-solidity-with-ai", "free-ai-app-builder", "idea-to-app-in-a-weekend"],
  },
  {
    slug: "how-much-does-an-ai-app-builder-cost",
    query: "how much does an ai app builder cost",
    cluster: "free",
    title: "How Much Does an AI App Builder Cost? What to Expect",
    description: "AI app builder pricing explained: credits, subscriptions and pay-per-build. How GoodBuild charges, and what to watch for in any builder's pricing.",
    date,
    intro: "AI app builders usually charge in one of three ways: a monthly plan, credits you buy, or the actual cost of each build. Knowing which one you are on is the key to not being surprised.",
    sections: [
      {
        heading: "Three pricing shapes",
        bullets: [
          "**Subscriptions.** A monthly price with a usage allowance.",
          "**Credits.** You buy a pack and spend it as you build.",
          "**Pay for what it costs.** You pay the real AI cost of each build plus a margin.",
        ],
      },
      {
        heading: "How GoodBuild charges",
        paragraphs: [
          "Free now: $0.20 of AI for each new account during the testnet beta. After the beta: the actual AI cost of each build plus 25%, shown in US dollars with the G$ amount alongside. You see an estimate before each build. Credits are bought in G$ packs, and wallets verified with GoodDollar get a 10% bonus up to a monthly cap. Network fees for deploys go to the network, from your own wallet.",
        ],
      },
      {
        heading: "What to watch for in any builder",
        bullets: ["Does a failed build cost you?", "Do fixes cost the same as new builds?", "Is there an estimate before you spend?", "What happens to unused credits?", "Are hosting and domains included?"],
      },
      { heading: "How to spend less", paragraphs: ["Clear prompts and one change at a time use fewer builds. See [make the free allowance last](/blog/free-ai-app-builder)."] },
      { heading: "Check the current page", paragraphs: ["Prices change. This post describes GoodBuild as of November 2026. The [pricing section](/#pricing) is always current."] },
    ],
    related: ["free-ai-app-builder", "best-ai-app-builders-2026", "ai-app-builder-vs-hiring-a-developer"],
  },
];
