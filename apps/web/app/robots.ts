import type { MetadataRoute } from "next";

const PRIVATE_PATHS = ["/crm/", "/api/", "/login", "/favorites", "/mcp"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "ChatGPT-User",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "GPTBot",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: [
      "https://avtocena.com/sitemap.xml",
      "https://avtocena.com/cars/sitemap.xml",
    ],
    host: "https://avtocena.com",
  };
}
