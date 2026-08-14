export const dynamic = "force-dynamic";

const PRIVATE_PATHS = ["/crm/", "/api/", "/login", "/favorites", "/mcp"];
const USER_AGENTS = ["OAI-SearchBot", "ChatGPT-User", "GPTBot", "*"];

function blockFor(userAgent: string) {
  return [
    `User-agent: ${userAgent}`,
    "Allow: /",
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
  ].join("\n");
}

export function GET() {
  const body = [
    ...USER_AGENTS.map(blockFor),
    "Sitemap: https://avtocena.com/sitemap.xml",
    "Sitemap: https://avtocena.com/cars/models-sitemap.xml",
    "Sitemap: https://avtocena.com/cars/sitemap.xml",
    "Host: https://avtocena.com",
    "",
  ].join("\n\n");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
