import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const BASE_URL = "https://autopapa.ge";
const DETAIL_PATH_RE = /^\/en\/usd\/[^/?#]+\/[^/?#]+\/(\d{5,})\/?$/i;
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};
const NON_CAR_RE = /\b(?:motorcycle|scooter|jet\s*ski|watercraft|personal\s+watercraft|super\s*jet|forklift|excavator|tractor|crane|truck|bus|commercial|cargo|spare parts?)\b/i;
const BAD_IMAGE_RE = /logo|favicon|icon|sprite|banner|placeholder|avatar|tracking|pixel|cookie|qrcode|qr-code|no[-_ ]?photo|no[-_ ]?image|question|\/flags\//i;
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((left, right) => right.length - left.length);

export type AutoPapaGeorgiaRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: "USD";
  mileageKm?: number;
  engineCc?: number;
  fuel?: string;
  transmission?: string;
  bodyType?: string;
  location?: string;
  images: string[];
};

function decode(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;|\u00a0/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function plain(value: string) {
  return decode(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}

function absolute(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(decode(value).replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}

function integer(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function autopapaMileage(token: string | undefined, thousandsMarker: boolean) {
  const parsed = integer(token);
  if (!parsed) return undefined;
  return thousandsMarker && parsed < 1_000 ? parsed * 1_000 : parsed;
}

function titleIdentity(value: string) {
  const title = plain(value).replace(/\s+/g, " ").trim();
  const lower = title.toLocaleLowerCase("en-US");
  const known = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (known) return { title, make: known, model: title.slice(known.length).replace(/^[\s\-–—|]+/, "").trim() };
  const parts = title.split(/\s+/).filter(Boolean);
  return { title, make: parts[0] || "", model: parts.slice(1).join(" ") };
}

function markupImageValues(markup: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source|meta|a)[^>]+(?:data-original|data-lazy-src|data-src|src|content|href)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return values;
}

function listingPhotoUrls(markup: string, base: string) {
  return [...new Set(markupImageValues(markup).map((value) => absolute(value, base)).filter((url) => {
    if (!/^https?:/i.test(url) || BAD_IMAGE_RE.test(url)) return false;
    try { const parsed = new URL(url); return parsed.host === "autopapa.ge" && /\/system\/car\/photos\//i.test(parsed.pathname); } catch { return false; }
  }))];
}

/**
 * AutoPapa exact detail pages expose the listing gallery's full-size images as
 * direct `.../system/car/photos/.../original.jpg` URLs. Recommendation cards on
 * the same page use `thumb.jpg`; label/cover variants use `labels*`/`small.jpg`.
 * Keep only direct originals that AutoPapa actually emitted. Never synthesize a
 * missing original URL from a thumb/medium/small path.
 */
export function autoPapaDetailOriginalPhotoUrls(markup: string, base = BASE_URL) {
  return [...new Set(markupImageValues(markup).map((value) => absolute(value, base)).filter((url) => {
    if (!/^https:/i.test(url) || BAD_IMAGE_RE.test(url)) return false;
    try {
      const parsed = new URL(url);
      return parsed.host === "autopapa.ge"
        && /^\/system\/car\/photos\/\d{3}\/\d{3}\/\d{3}\/original\.jpg$/i.test(parsed.pathname);
    } catch { return false; }
  }))];
}

/**
 * Some exact AutoPapa detail pages publish the seller-entered engine power in
 * the primary vehicle facts block as `Power: N hp`. Keep the parser deliberately
 * narrow: only the facts block between `Body Type:` and `Car description` is
 * considered, so recommendation cards later on the page cannot donate power to
 * this listing. A blank primary `Power:` remains unknown.
 */
export function autoPapaDetailPowerHp(markup: string) {
  const text = plain(markup);
  const start = text.search(/\bBody\s+Type\s*:/i);
  if (start < 0) return undefined;
  const carDescription = text.indexOf("Car description", start);
  const facts = text.slice(start, carDescription > start ? carDescription : Math.min(text.length, start + 1_800));
  const match = facts.match(/\bPower\s*:\s*([0-9]{1,4}(?:[.,][0-9]+)?)\s*(?:hp|horsepower)\b/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 20 && value <= 2_500 ? value : undefined;
}

/**
 * AutoPapa detail pages can contain several dollar amounts: the live asking
 * price beside the primary H1, Georgian customs helper estimates, recommendation
 * cards and even stale seller-entered text such as `Cena: ...`. Only the amount
 * in the primary header before the first `STARTING PRICE ...` helper block is
 * authoritative for the source vehicle price.
 */
function autoPapaSinglePriceToken(value: string) {
  const values = [
    ...value.matchAll(/(?:USD|US\$|\$)\s*([0-9][0-9\s,.'’]{1,18})/gi),
    ...value.matchAll(/([0-9][0-9\s,.'’]{1,18})\s*(?:USD|US\$|\$)/gi),
  ]
    .map((match) => integer(match[1]))
    .filter((price): price is number => Boolean(price && price >= 500 && price <= 5_000_000));
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function autoPapaSellerDeclaredPriceUsd(markup: string) {
  const text = plain(markup);
  const start = text.search(/\bMore\s+details\b/i);
  if (start < 0) return undefined;
  const tail = text.slice(start, Math.min(text.length, start + 2_500));
  const end = tail.search(/\b(?:let\s+me\s+know\s+when\s+a\s+car\s+like\s+this\s+is\s+found|add\s+to\s+favorites|send\s+to\s+friend|Report\s+ad|views|created\s+at)\b/i);
  const details = tail.slice(0, end > 0 ? end : tail.length);
  const match = details.match(/\b(?:Cena|Цена)\s*:\s*([0-9][0-9\s,.'’]{1,18})\s*(?:USD|US\$|\$)/i);
  const value = integer(match?.[1]);
  return value && value >= 500 && value <= 5_000_000 ? value : undefined;
}

export function autoPapaStructuredPrimaryPriceUsd(markup: string, identity?: Pick<VehicleOffer, "make" | "model">) {
  const text = plain(markup);
  const helperIndex = text.search(/\bSTARTING\s+PRICE\s+(?:AT|IN)\b/i);
  const factsIndex = text.search(/\bBody\s+Type\s*:/i);
  const primaryEnd = helperIndex >= 0 ? helperIndex : factsIndex >= 0 ? factsIndex : Math.min(text.length, 6_000);
  const primary = text.slice(0, primaryEnd);
  const title = [identity?.make, identity?.model].map((value) => String(value || "").trim()).filter(Boolean).join(" " );
  if (title) {
    const escaped = title.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    const matches = [...primary.matchAll(new RegExp(escaped, "ig"))];
    for (let index = matches.length - 1; index >= 0; index--) {
      const match = matches[index];
      const start = Number(match.index || 0) + match[0].length;
      const price = autoPapaSinglePriceToken(primary.slice(start, Math.min(primary.length, start + 320)));
      if (price) return price;
    }
  }
  return autoPapaSinglePriceToken(primary.slice(Math.max(0, primary.length - 900)));
}

/**
 * Seller-entered `Cena: ... $` in this exact vehicle's More details block is
 * authoritative when present. The structured title price is only a fallback.
 */
export function autoPapaDetailPriceUsd(markup: string, identity?: Pick<VehicleOffer, "make" | "model">) {
  return autoPapaSellerDeclaredPriceUsd(markup) || autoPapaStructuredPrimaryPriceUsd(markup, identity);
}

function autoPapaDetailIdentity(url: string) {
  try { return new URL(url).pathname.match(DETAIL_PATH_RE)?.[1] || ""; } catch { return ""; }
}

export function autoPapaExactDetailFacts(offer: Partial<VehicleOffer>, markup: string, responseUrl: string) {
  const sourceOfferId = String(offer.sourceOfferId || "").trim();
  const requestedUrl = String(offer.operational?.sourceUrl || "");
  if (offer.sourceId !== "autopapa_georgia_open" || !/^\d{5,}$/.test(sourceOfferId)) return null;
  if (autoPapaDetailIdentity(requestedUrl) !== sourceOfferId || autoPapaDetailIdentity(responseUrl) !== sourceOfferId) return null;
  const originals = autoPapaDetailOriginalPhotoUrls(markup, responseUrl).slice(0, 30);
  const sellerDeclaredPriceUsd = autoPapaSellerDeclaredPriceUsd(markup);
  const structuredPriceUsd = autoPapaStructuredPrimaryPriceUsd(markup, offer);
  const priceUsd = sellerDeclaredPriceUsd || structuredPriceUsd;
  const priceAuthority = sellerDeclaredPriceUsd ? "seller_declared_cena" : structuredPriceUsd ? "structured_primary" : undefined;
  const powerHp = String(offer.powertrainKind || "") === "combustion" ? autoPapaDetailPowerHp(markup) : undefined;
  return { sourceOfferId, originals, powerHp, priceAuthority, sellerDeclaredPriceUsd, structuredPriceUsd, ...(priceUsd ? { priceUsd } : {}) };
}

export function enrichAutoPapaOfferFromExactDetail(offer: VehicleOffer, markup: string, responseUrl: string) {
  const facts = autoPapaExactDetailFacts(offer, markup, responseUrl);
  if (!facts) return null;
  const raw = typeof offer.operational?.raw === "object" && offer.operational.raw
    ? offer.operational.raw as Record<string, unknown>
    : {};
  offer.operational = {
    ...offer.operational,
    raw: {
      ...raw,
      autoPapaDetailIdentityVerified: true,
      autoPapaDetailOriginals: facts.originals,
      autoPapaDetailPriceVerified: Boolean(facts.priceUsd),
      ...(facts.priceUsd ? { autoPapaDetailPriceUsd: facts.priceUsd } : {}),
      ...(facts.priceAuthority ? { autoPapaDetailPriceAuthority: facts.priceAuthority } : {}),
      ...(facts.sellerDeclaredPriceUsd ? { autoPapaSellerDeclaredPriceUsd: facts.sellerDeclaredPriceUsd } : {}),
      ...(facts.structuredPriceUsd ? { autoPapaStructuredPriceUsd: facts.structuredPriceUsd } : {}),
      ...(facts.powerHp ? { autoPapaDetailPowerHp: facts.powerHp } : {}),
    },
  };
  if (facts.priceUsd) {
    offer.sourcePrice = facts.priceUsd;
    offer.sourceCurrency = "USD";
  }
  if (facts.powerHp) {
    offer.powerHp = facts.powerHp;
    offer.powerKw = Math.round((facts.powerHp / 1.3596216173) * 100) / 100;
    offer.powerDataConfidence = "source_exact";
    offer.powerDataSource = `autopapa-detail:${facts.sourceOfferId}:Power`;
  }
  return facts;
}

export function parseAutoPapaGeorgiaListing(markup: string, pageUrl = `${BASE_URL}/en/usd/search?page=1`): AutoPapaGeorgiaRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absolute(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((item) => { try { return DETAIL_PATH_RE.test(new URL(item.href).pathname); } catch { return false; } });

  const grouped = new Map<string, { href: string; index: number; titles: string[] }>();
  for (const anchor of anchors) {
    const current = grouped.get(anchor.href) || { href: anchor.href, index: anchor.index, titles: [] };
    current.index = Math.min(current.index, anchor.index);
    const candidate = plain(anchor.inner);
    if (candidate.length >= 3 && candidate.length <= 140 && !/^(?:image|details?|view|save|add)$/i.test(candidate)) current.titles.push(candidate);
    grouped.set(anchor.href, current);
  }

  const entries = [...grouped.values()].sort((left, right) => left.index - right.index);
  const rows: AutoPapaGeorgiaRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const id = new URL(entry.href).pathname.match(DETAIL_PATH_RE)?.[1];
    if (!id) continue;
    const nextIndex = entries[index + 1]?.index || Math.min(markup.length, entry.index + 14_000);
    const card = markup.slice(entry.index, Math.max(entry.index + 1, nextIndex));
    const cardText = plain(card);
    const title = [...entry.titles].sort((left, right) => right.length - left.length)[0] || "";
    const identity = titleIdentity(title);
    const year = Number(cardText.match(/\b(19\d{2}|20\d{2})\s*year\b/i)?.[1] || 0);
    const priceText = cardText.match(/(?:USD|US\$|\$)\s*([^$]{1,32}?)\s+(?:19|20)\d{2}\s*year\b/i)?.[1];
    const price = integer(priceText);
    if (!identity.make || !identity.model || year < 2020 || !price || price < 500 || price > 5_000_000 || NON_CAR_RE.test(`${identity.title} ${cardText}`)) continue;

    const kMileage = cardText.match(/\b([0-9]{1,3}(?:[\s,.'][0-9]{3})*|[0-9]{1,7})\s*K\.\s*km\b/i)?.[1];
    const regularMileage = cardText.match(/\b([0-9]{1,3}(?:[\s,.'][0-9]{3})*|[0-9]{1,7})\s*km\b/i)?.[1];
    const liters = cardText.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*l\b/i)?.[1];
    const fuel = cardText.match(/\b(petrol\/gas|petrol|gasoline|diesel|hybrid|plug[- ]?in hybrid|phev|electric|ev|lpg)\b/i)?.[1];
    const transmission = cardText.match(/\b(automatic|manual|cvt|dct|at|mt)\b/i)?.[1];
    const bodyType = cardText.match(/\b(suv|crossover|minivan|sedan|hatchback|coupe|wagon|estate|mpv|convertible|cabrio)\b/i)?.[1];
    const location = cardText.match(/\b(Tbilisi|Batumi|Rustavi|Kutaisi|Poti|Gori|Kobuleti|Telavi)\b/i)?.[1];

    rows.push({
      id, detailUrl: entry.href, title: identity.title, make: identity.make, model: identity.model, year, price, currency: "USD",
      mileageKm: autopapaMileage(kMileage || regularMileage, Boolean(kMileage)),
      engineCc: liters ? Math.round(Number(liters.replace(",", ".")) * 1_000) : undefined,
      fuel, transmission, bodyType, location, images: listingPhotoUrls(card, pageUrl),
    });
  }
  return rows;
}

async function request(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 20_000));
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: "follow", cache: "no-store", signal: controller.signal });
    const markup = await response.text();
    if ([401, 403, 429].includes(response.status) || /just a moment|cf-chl|captcha|access denied/i.test(markup.slice(0, 2_000))) throw new Error(`autopapa_georgia_blocked_${response.status}`);
    if (!response.ok) throw new Error(`autopapa_georgia_http_${response.status}`);
    return { response, markup };
  } finally { clearTimeout(timeout); }
}

export class AutoPapaGeorgiaAdapter implements CatalogSourceAdapter {
  sourceId = "autopapa_georgia_open";
  market = "georgia" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = new URL(`${BASE_URL}/en/usd/search`);
    url.searchParams.set("order", "date_desc");
    url.searchParams.set("s[year_from]", "2020");
    url.searchParams.set("show_comments", "1");
    url.searchParams.set("page", String(page));
    const result = await request(url.toString());
    const items = parseAutoPapaGeorgiaListing(result.markup, result.response.url || url.toString());
    if (!items.length) throw new Error(`autopapa_georgia_parsed_zero_status_${result.response.status}_bytes_${result.markup.length}`);
    return { items, nextCursor: String(page + 1), finished: false, count: items.length,
      health: { ok: true, message: `AutoPapa Georgia parsed ${items.length}`, checkedAt: new Date().toISOString(), httpStatus: result.response.status, contentType: result.response.headers.get("content-type") || "" } };
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: AutoPapaGeorgiaRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || raw.year < 2020 || !raw.price || !raw.detailUrl) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id), sourceId: this.sourceId, sourceOfferId: raw.id, market: "georgia",
      offerType: "fixed", status: "active", make: raw.make, model: raw.model, trim: raw.title, year: raw.year,
      mileageKm: raw.mileageKm, engineCc: raw.engineCc, fuel: raw.fuel, transmission: raw.transmission, bodyType: raw.bodyType,
      sourcePrice: raw.price, sourceCurrency: raw.currency, priceMode: "fixed", images: [], totalRub: null, calculationStatus: "needs_data",
      firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: raw.detailUrl, sourceVenueName: raw.location || "AutoPapa Georgia", sourcePublishedAt: now,
        raw: { images: raw.images, parsed: raw, listingBoundImages: true } },
    } as VehicleOffer) as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational?.raw as { images?: string[]; parsed?: AutoPapaGeorgiaRow } | undefined;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    let urls = [...new Set([...(raw?.images || []), ...(raw?.parsed?.images || [])])];
    const detailUrl = String(offer.operational?.sourceUrl || raw?.parsed?.detailUrl || "");
    if (detailUrl) {
      const detail = await request(detailUrl).catch(() => null);
      if (detail) {
        const facts = enrichAutoPapaOfferFromExactDetail(offer, detail.markup, detail.response.url || detailUrl);
        if (facts) {
          if (facts.originals.length) urls = facts.originals;
          if ((offer.images || []).length >= limit) return offer.images.slice(0, limit);
        }
      }
    }
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "georgia", { headers: HEADERS }).catch(() => null);
      if (image && image.size > 8_000 && !saved.some((item) => item.id === image.id)) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() { return { ok: true, message: "AutoPapa canonical Yandex parser", checkedAt: new Date().toISOString() }; }
}

export const autoPapaGeorgiaSource = new AutoPapaGeorgiaAdapter();
