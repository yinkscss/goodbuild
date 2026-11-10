import type { MetadataRoute } from "next";

import { SITE_URL } from "@/config/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: ["/", "/blog"], disallow: ["/api/", "/home", "/p/", "/credits", "/deployments", "/a/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
