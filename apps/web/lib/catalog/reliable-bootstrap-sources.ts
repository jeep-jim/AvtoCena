import { GuaziRuAdapter, parseGuaziRuMarkup } from "./guazi-ru-source";
import type { CatalogFetchResult, CatalogSourceAdapter } from "./types";

const GUAZI_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ru-RU;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

class GuaziGlobalAdapter extends GuaziRuAdapter {
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const paths = page === 1 ? ["used-cars/"] : [`used-cars/page${page}/`];
    const urls = paths.flatMap((path) => [
      `https://en.guazi.com/${path}`,
      `https://ru.guazi.com/${path}`,
    ]);
    let lastError = "";

    for (const url of urls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15_000));
      try {
        const response = await fetch(url, { headers: GUAZI_HEADERS, redirect: "follow", signal: controller.signal });
        const markup = await response.text();
        if (!response.ok) {
          lastError = `guazi_global_http_${response.status}_${new URL(url).hostname}`;
          continue;
        }
        if (/captcha|verify you are human|access denied|request blocked|cloudflare/i.test(markup.slice(0, 4_000))) {
          lastError = `guazi_global_blocked_${response.status}_${new URL(url).hostname}`;
          continue;
        }
        const items = parseGuaziRuMarkup(markup, response.url || url);
        if (!items.length) {
          lastError = `guazi_global_parsed_zero_${new URL(url).hostname}`;
          continue;
        }
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: {
            ok: true,
            message: `Guazi Global parsed ${items.length} from ${new URL(response.url || url).hostname}`,
            checkedAt: new Date().toISOString(),
            httpStatus: response.status,
            contentType: response.headers.get("content-type") || "",
          },
        };
      } catch (error) {
        lastError = String((error as Error)?.message || error);
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError) throw new Error(lastError);
    return { items: [], nextCursor: null, finished: true, count: 0 };
  }
}

export const reliableBootstrapSources: CatalogSourceAdapter[] = [
  new GuaziGlobalAdapter(),
];
