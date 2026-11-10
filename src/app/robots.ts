import type { MetadataRoute } from "next";

import { SITE_URL } from "@/config/site-url";

const PRIVATE = ["/api/", "/home", "/p/", "/credits", "/deployments", "/a/"];

/** Crawlers that fetch pages for AI answers and search. Named so the intent is explicit, with the same private paths as everyone else. */
const AI_CRAWLERS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bingbot", "CCBot", "Amazonbot", "cohere-ai", "MistralAI-User", "DuckAssistBot"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: ["/", "/llms.txt", "/llms-full.txt"], disallow: PRIVATE })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
