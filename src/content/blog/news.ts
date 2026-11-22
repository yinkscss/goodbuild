import type { Post } from "./types";

export const newsPosts: Post[] = [
  {
    slug: "futminna-hackathon-scholarship",
    query: "futminna hackathon scholarship",
    cluster: "news",
    title: "FUTMinna Hackathon: Win a ₦150,000 Scholarship",
    description: "GoodBuild and GoodCash open their first campus hackathon at FUTMinna. One builder wins a ₦150,000 scholarship. Registration is open until 10 December.",
    date: "2026-11-21",
    intro: "GoodBuild has opened registration for the FUTMinna hackathon, its first at a university. One creative builder at the Federal University of Technology Minna wins a ₦150,000 scholarship, and it is the first of many hackathons across Nigerian universities.",
    image: { src: "/blog/futminna-hackathon.png", alt: "FUTMinna Hackathon: build something good and win a ₦150,000 scholarship, by GoodBuild and GoodCash" },
    sections: [
      {
        heading: "Why we're doing this",
        paragraphs: [
          "GoodDollar exists to reduce global financial inequality through universal basic income. GoodBuild wants to take that idea further, by giving students the tools to build useful things on top of it and rewarding the best of them.",
        ],
      },
      {
        heading: "What G$ is",
        paragraphs: [
          "G$ is GoodDollar's digital currency. It puts a small, regular amount of money in the hands of ordinary people, not only those who already have capital. See [what G$ is and what you can build with it](/blog/what-is-g-dollar-gooddollar-apps).",
        ],
        bullets: [
          "**Free to claim.** A person proves they are one real human with a free face check, then claims G$ at no cost.",
          "**One person, one share.** The check keeps the benefit with real people, not accounts created in bulk.",
          "**Runs on Celo.** Fees are low, so G$ suits everyday payments, savings and community tools.",
        ],
      },
      {
        heading: "What judges look for",
        paragraphs: ["Students of FUTMinna build an app or game on GoodBuild. The top five projects are judged by GoodBuild and GoodCash judges on four things:"],
        steps: [
          "**Built using GoodBuild.** The project starts on GoodBuild.",
          "**One meaningful G$ integration.** G$ is part of what the app does, not decoration.",
          "**Live on Celo mainnet.** It is deployed and anyone can use it. See [how to build a dApp on Celo](/blog/how-to-build-a-dapp-on-celo).",
          "**Creative and published.** It solves a real problem.",
        ],
      },
      {
        heading: "How votes work",
        paragraphs: [
          "Builders climb the leaderboard when friends, family and the wider community approve their projects. The top five by approvals go to the judges, who choose the winner. Each voter does GoodDollar's free face check first, so it is one person, one voice.",
        ],
      },
      {
        heading: "Who can enter",
        paragraphs: [
          "Registration is open now and entries close on 10 December. The hackathon is open to FUTMinna students aged 18 and over, and is not open to US persons. The winner must show they are a FUTMinna student before the scholarship is paid. [Register for the FUTMinna hackathon](/hackathon/futminna).",
        ],
      },
    ],
    related: ["what-is-g-dollar-gooddollar-apps", "how-to-build-a-dapp-on-celo", "ai-app-builder-for-students", "build-a-dapp-without-coding"],
  },
];
