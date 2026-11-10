import type { Post } from "./types";

const date = "2026-11-10";

export const vibePosts: Post[] = [
  {
    slug: "what-is-vibe-coding",
    query: "what is vibe coding",
    cluster: "vibe",
    title: "What Is Vibe Coding? A Plain-English Explanation",
    description: "Vibe coding means building software by describing it to an AI that writes the code. What it is, what it is good for, where it fails and how to start.",
    date,
    intro: "Vibe coding is building software by describing what you want in everyday language and letting an AI write the code. You steer by testing and asking for changes, not by typing the code yourself.",
    sections: [
      {
        heading: "How it works",
        steps: ["You describe the app.", "The AI writes the code and runs it.", "You try it and say what is wrong or missing.", "The AI changes it. Repeat."],
      },
      {
        heading: "What it is good for",
        bullets: ["First versions and prototypes.", "Small tools, games and landing pages.", "Learning, because you see real code appear.", "Testing an idea before spending real money on it."],
      },
      {
        heading: "Where it falls short",
        bullets: ["The AI can be confidently wrong, so you must test.", "Code you didn't read can hide mistakes.", "Money-handling code needs extra care. See [is AI-generated code safe](/blog/is-ai-generated-smart-contract-safe)."],
      },
      {
        heading: "Vibe coding for blockchain apps",
        paragraphs: ["The same loop works for a dApp: describe, generate, test on a test network, adjust. [GoodBuild](/) is a vibe-coding tool built for Celo, with a contract and a front end in one build."],
      },
      { heading: "Get started", paragraphs: ["Read [prompt tips](/blog/vibe-coding-prompt-tips), choose a small idea and build it. See [the best tools for beginners](/blog/best-vibe-coding-tools-for-beginners)."] },
    ],
    faq: [{ q: "Is vibe coding the same as no-code?", a: "No. No-code uses pre-made blocks. Vibe coding generates real code. See [no-code vs vibe coding](/blog/no-code-vs-vibe-coding)." }],
    related: ["vibe-coding-prompt-tips", "no-code-vs-vibe-coding", "best-vibe-coding-tools-for-beginners"],
  },
  {
    slug: "vibe-coding-prompt-tips",
    query: "ai app builder prompt tips",
    cluster: "vibe",
    title: "10 Prompt Tips for Getting a Better App From an AI Builder",
    description: "Ten practical prompt tips for AI app builders: say who uses it, give numbers, ask for phone layout, answer questions and change one thing at a time.",
    date,
    intro: "The prompt is most of the work. These ten habits get a better first build and cost fewer rebuilds.",
    sections: [
      {
        heading: "The ten tips",
        steps: [
          "**Say who uses it.** \"Members of my savings group\" beats \"users\".",
          "**Describe the steps they take.** First this, then that.",
          "**Give numbers.** Amounts, limits, counts and deadlines.",
          "**Name the token.** G$, a stablecoin or test tokens.",
          "**Say \"phone first\".** And name the one main action.",
          "**State what must not happen.** \"No one can withdraw twice.\"",
          "**Answer the builder's questions.** They exist because the prompt had gaps.",
          "**Change one thing at a time.** You'll see which change caused which result.",
          "**Describe problems, not fixes.** \"The pay button does nothing on my phone\" works better than guessing the cause.",
          "**Test before asking for more.** Click everything in the preview.",
        ],
      },
      { heading: "A before and after", paragraphs: ["Before: \"Make a donation app.\" After: \"A page for our school's library fund. Visitors pick 2, 5 or 10 G$ or enter an amount. Show a progress bar toward 500 G$ and a list of the last ten donors. Phone first. The money goes straight to the library's wallet.\""] },
      { heading: "Save your allowance", paragraphs: ["Fewer rebuilds mean a longer free allowance. See [what free means](/blog/free-ai-app-builder). Try your prompt in [GoodBuild](/)."] },
    ],
    related: ["what-is-vibe-coding", "build-an-app-with-ai-no-coding-experience", "idea-to-app-in-a-weekend"],
  },
  {
    slug: "vibe-coding-web3-risks",
    query: "vibe coding a blockchain app risks",
    cluster: "vibe",
    title: "Vibe Coding a Blockchain App: The Risks and the Fixes",
    description: "Vibe coding a blockchain app is fast, and mistakes are permanent. The main risks, from logic bugs to key theft, and a checklist to reduce them.",
    date,
    intro: "Vibe coding is fast. Blockchains are unforgiving. The combination works, if you add the checks a normal app would not need.",
    sections: [
      {
        heading: "The main risks",
        bullets: [
          "**Permanent mistakes.** A deployed contract usually can't be edited.",
          "**Logic bugs that look fine.** Plausible code, wrong rule.",
          "**Keys.** Anyone with your private key controls your funds. GoodBuild never holds your keys, and you should never paste a key into a chat.",
          "**Scam copies.** Fake versions of your app with a different address.",
          "**Unclear legal status.** Money apps can be regulated.",
        ],
      },
      {
        heading: "A checklist",
        steps: [
          "Test on Celo Sepolia first.",
          "Try to break it: zero, huge amounts, repeated calls, wrong wallets.",
          "Read the plain-language summary of each function.",
          "Cap amounts at the start.",
          "Get a human review before real money.",
          "Publish your official link in one place and tell people about it.",
        ],
      },
      { heading: "The honest position", paragraphs: ["GoodBuild's contracts are unaudited, and its Terms say so. That is true of any AI-written contract. The tool makes a first version quickly; the responsibility for what goes on mainnet stays with the person who signs."] },
    ],
    faq: [
      { q: "Should I paste my private key into an AI chat?", a: "Never. Keys give full control of your funds. GoodBuild never asks for yours: your wallet signs each deploy." },
      { q: "How do I spot a scam copy of my app?", a: "Publish your official link in one place, such as your profile, and tell users to use only that link." },
      { q: "Is a test network really safe to experiment on?", a: "Yes. Test tokens have no value, so mistakes cost nothing. It is the right place to break things." },
    ],
    related: ["is-ai-generated-smart-contract-safe", "ai-app-builder-vs-hiring-a-developer", "deploy-smart-contract-celo-sepolia"],
  },
  {
    slug: "idea-to-app-in-a-weekend",
    query: "turn an idea into an app in a weekend with ai",
    cluster: "vibe",
    title: "From Idea to Live App in One Weekend With AI",
    description: "A weekend plan to turn an idea into a live app: define it Friday, build Saturday, test with real people Sunday. No coding needed.",
    date,
    intro: "With an AI builder, a first version of a simple app fits in a weekend. This is a plan that keeps the scope small enough to finish.",
    sections: [
      {
        heading: "Friday evening: define",
        steps: ["Pick one idea and write it as a paragraph.", "List who uses it and the one action they take.", "Decide what happens with money, if any, and which token.", "Pick the test network."],
      },
      {
        heading: "Saturday: build",
        steps: ["Put the paragraph into [GoodBuild](/) and answer its questions.", "Click every button in the preview.", "Ask for changes, one at a time.", "Deploy to Celo Sepolia and use it from two wallets.", "Publish to a live link."],
      },
      {
        heading: "Sunday: test with people",
        steps: ["Send the link to five people.", "Watch what they tap and where they stop.", "Write down the three biggest problems.", "Fix the top one."],
      },
      { heading: "Monday: decide", bullets: ["Did anyone use it without help?", "Do they want it again?", "If yes, plan a review and a mainnet launch. If not, change the idea, not the code."] },
      { heading: "Tools", paragraphs: ["The [free allowance](/blog/free-ai-app-builder) covers a few small builds, and [prompt tips](/blog/vibe-coding-prompt-tips) make it go further."] },
    ],
    faq: [
      { q: "Is a weekend really enough?", a: "For one small idea, yes. Keep the scope to a single action and save extras for next week." },
      { q: "What if I get stuck?", a: "Describe what you see, not what you think is wrong, and send it as a message. Change one thing at a time." },
      { q: "When should I go to mainnet?", a: "After testing on Celo Sepolia with real people, and after a review if the app holds money." },
    ],
    related: ["build-an-app-with-ai-no-coding-experience", "vibe-coding-prompt-tips", "minipay-mini-app-ideas"],
  },
];
