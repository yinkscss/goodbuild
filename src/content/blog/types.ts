/** One section of a post. Text may hold [label](/path) links, which the renderer turns into <a>. */
export interface PostSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  steps?: string[];
}

export type PostCluster = "minipay" | "celo" | "compare" | "free" | "ideas" | "vibe";

export interface Post {
  slug: string;
  /** The single search query this post is written to answer. No two posts share one (blog.test.ts). */
  query: string;
  cluster: PostCluster;
  /** At most 58 characters, used as the H1 and the page title. */
  title: string;
  /** At most 160 characters. */
  description: string;
  /** ISO date. Posts are dated the day they were written, never back-dated. */
  date: string;
  intro: string;
  sections: PostSection[];
  faq?: Array<{ q: string; a: string }>;
  /** Slugs of other posts to link at the end. */
  related: string[];
  /** Roundups name GoodBuild in their list and say when they were written. */
  roundup?: boolean;
}

export const CLUSTERS: Record<PostCluster, { label: string; blurb: string }> = {
  minipay: { label: "MiniPay apps", blurb: "Mini payment apps that run inside the MiniPay wallet." },
  celo: { label: "Blockchain apps", blurb: "dApps, smart contracts and the Celo network, in plain words." },
  compare: { label: "AI builders compared", blurb: "How the AI app builders differ and where GoodBuild fits." },
  free: { label: "Free and no-code", blurb: "Building an app with AI when you can't code or don't want to pay." },
  ideas: { label: "App ideas with G$", blurb: "Things you can build and run with G$, one post per idea." },
  vibe: { label: "Vibe coding", blurb: "Building software by describing it, and doing it well." },
};
