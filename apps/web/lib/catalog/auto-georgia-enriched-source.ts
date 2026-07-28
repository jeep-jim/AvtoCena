import { autoGeorgiaExactSource } from "./auto-georgia-source";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8,ru;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function plain(markup: string) {
  return String(markup || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listingPriority(raw: unknown) {
  const row = raw as any;
  const text = `${row?.make || ""} ${row?.model || ""} ${row?.title || ""}`;
  if (/Toyota\s+RAV\s*4/i.test(text)) return 100;
  if (/Toyota\s+(?:Camry|Corolla|Alphard)/i.test(text)) return 80;
  if (/Nissan\s+(?:Rogue|X-?Trail|Qashqai)/i.test(text)) return 60;
  if (/Honda\s+(?:CR-?V|HR-?V|Fit|Vezel)/i.test(text)) return 50;
  return 0;
}

async function enrichFromDetail(offer: VehicleOffer) {
  const url = String(offer.operational?.sourceUrl || "");
  if (!url) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 18_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer: url }, redirect: "follow", signal: controller.signal });
    if (!response.ok) return;
    const text = plain(await response.text());
    const labeledEngine = Number(text.match(/\bEngine\s+([0-9]+(?:[.,][0-9]+)?)(?=\s+Turbo\b)/i)?.[1]?.replace(",", ".") || 0);
    if (!offer.engineCc && labeledEngine >= 0.6 && labeledEngine <= 8) offer.engineCc = Math.round(labeledEngine * 1_000);
    const fuel = text.match(/\bFuel\s+(Gas|Petrol|Diesel|Hybrid|Electric)\b/i)?.[1]?.toLowerCase();
    if (!offer.fuel && fuel) offer.fuel = fuel === "gas" ? "petrol" : fuel;
    const transmission = text.match(/\bTransmission\s+(Automanual|Automatic|Manual|CVT)\b/i)?.[1]?.toLowerCase();
    if (!offer.transmission && transmission) offer.transmission = transmission === "automanual" ? "automatic" : transmission;
    const drive = text.match(/\bDrive Train\s+(All Wheel Drive|Four Wheel Drive|Front Wheel Drive|Rear Wheel Drive)\b/i)?.[1]?.toLowerCase();
    if (!offer.drive && drive) offer.drive = /all|four/.test(drive) ? "4wd" : /front/.test(drive) ? "fwd" : "rwd";
    const body = text.match(/\bBody Style\s+([A-Za-z -]{2,30}?)(?=\s+Customs\b)/i)?.[1]?.trim().toLowerCase();
    if (!offer.bodyType && body) offer.bodyType = body;
  } catch {
    // Карточка остаётся пригодной для retention, даже если detail временно недоступен.
  } finally {
    clearTimeout(timer);
  }
}

export const autoGeorgiaEnrichedSource: CatalogSourceAdapter = {
  sourceId: autoGeorgiaExactSource.sourceId,
  market: autoGeorgiaExactSource.market,
  accessMode: autoGeorgiaExactSource.accessMode,
  async fetchPage(cursor): Promise<CatalogFetchResult> {
    const result = await autoGeorgiaExactSource.fetchPage(cursor);
    return {
      ...result,
      items: [...(result.items || [])].sort((left, right) => listingPriority(right) - listingPriority(left)),
    };
  },
  normalizeOffer: (raw) => autoGeorgiaExactSource.normalizeOffer(raw),
  mapStatus: (raw) => autoGeorgiaExactSource.mapStatus(raw),
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const [images] = await Promise.all([
      autoGeorgiaExactSource.fetchImages ? autoGeorgiaExactSource.fetchImages(offer) : Promise.resolve([]),
      enrichFromDetail(offer),
    ]);
    return images;
  },
  healthCheck: () => autoGeorgiaExactSource.healthCheck(),
};
