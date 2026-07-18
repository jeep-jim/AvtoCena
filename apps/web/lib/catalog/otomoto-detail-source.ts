import { OtomotoCurrentAdapter } from "./otomoto-current-source";
import type { CatalogFetchResult } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

function clean(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
}

function integer(value: unknown) {
  const result = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}

function embeddedPrice(markup: string) {
  for (const match of markup.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack: unknown[] = [JSON.parse(match[1])];
      while (stack.length) {
        const value = stack.pop();
        if (Array.isArray(value)) { stack.push(...value); continue; }
        if (!value || typeof value !== "object") continue;
        const object = value as Record<string, unknown>;
        const offers = object.offers && typeof object.offers === "object" ? object.offers as Record<string, unknown> : null;
        const price = integer(offers?.price || offers?.lowPrice || object.price);
        const currency = String(offers?.priceCurrency || object.priceCurrency || "").toUpperCase();
        if (price && ["PLN", "EUR"].includes(currency)) return { price, currency };
        stack.push(...Object.values(object));
      }
    } catch { /* continue with other embedded scripts */ }
  }
  return null;
}

function visiblePrice(markup: string) {
  const plain = clean(markup);
  const amount = "([0-9]{1,3}(?:[ .\\u00a0\\u202f]\\d{3})+|[0-9]{4,7})(?![0-9])";
  for (const currency of ["PLN", "EUR"]) {
    const matches = [...plain.matchAll(new RegExp(`${amount}\\s*${currency}\\b`, "gi"))]
      .map((match) => integer(match[1]) || 0)
      .filter((price) => price >= 1_000 && price <= 5_000_000);
    if (matches.length) return { price: Math.max(...matches), currency };
  }
  return null;
}

async function fetchMarkup(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer: "https://www.otomoto.pl/osobowe" }, redirect: "follow", signal: controller.signal });
    return response.ok ? await response.text() : "";
  } finally {
    clearTimeout(timeout);
  }
}

export class OtomotoDetailAdapter extends OtomotoCurrentAdapter {
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const result = await super.fetchPage(cursor);
    const rows: unknown[] = [];
    for (let index = 0; index < result.items.length; index += 8) {
      const batch = await Promise.all(result.items.slice(index, index + 8).map(async (raw) => {
        const row = raw as Record<string, unknown>;
        const url = String(row.url || "");
        if (!url) return raw;
        const markup = await fetchMarkup(url).catch(() => "");
        if (!markup) return raw;
        const parsed = embeddedPrice(markup) || visiblePrice(markup);
        return parsed ? { ...row, price: parsed.price, currency: parsed.currency } : raw;
      }));
      rows.push(...batch);
    }
    return {
      ...result,
      items: rows,
      count: rows.length,
      health: {
        ...(result.health || { ok: true, checkedAt: new Date().toISOString() }),
        message: `${result.health?.message || "OTOMOTO"}; detail prices checked`,
      },
    };
  }
}

export const otomotoEuropeDetailSource = new OtomotoDetailAdapter();
