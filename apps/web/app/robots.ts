import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/crm/", "/api/", "/login"],
    },
    sitemap: "https://avtocena.com/sitemap.xml",
    host: "https://avtocena.com",
  };
}
