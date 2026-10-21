import { stableOfferId } from './storage';
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, SourceRunHealth, VehicleOffer } from './types';

const BASE = 'https://www.dongchedi.com';
const detailUrl = (value: unknown) => {
  try { const url = new URL(String(value || ''), BASE);
    return url.origin === BASE && /^\/usedcar\/\d+\/?$/.test(url.pathname) ? url : null;
  } catch { return null; }
};
const label = (value: any) => typeof value === 'string' ? value.trim() : typeof value?.name === 'string' ? value.name.trim() : '';

/** Public structured listings only. No application API, authentication or JS execution. */
export function parseDongchediPublicListings(markup: string): unknown[] {
  const rows = new Map<string, any>();
  const ambiguous = new Set<string>();
  const visit = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    const url = detailUrl(value.url || value['@id']);
    if (url && types.some(type => ['Car', 'Vehicle'].includes(type))) {
      if (rows.has(url.pathname) && JSON.stringify(rows.get(url.pathname)) !== JSON.stringify(value)) ambiguous.add(url.pathname);
      rows.set(url.pathname, value);
    }
    // Traverse standard listing containers, never arbitrary recommendations.
    for (const key of ['@graph', 'itemListElement', 'item']) if (value[key]) visit(value[key]);
  };
  for (const match of markup.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* An unrecognized block is not inventory. */ }
  }
  return [...rows.entries()].filter(([key]) => !ambiguous.has(key)).map(([, row]) => row);
}

export class DongchediPublicSource implements CatalogSourceAdapter {
  sourceId = 'dongchedi_china_open';
  market = 'china' as const;
  accessMode = 'public_html' as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = cursor ? Number(cursor) : 1;
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('dongchedi_invalid_cursor');
    const url = `${BASE}/usedcar${page > 1 ? `?page=${page}` : ''}`;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000),
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0' } });
    const markup = await response.text();
    const location = new URL(response.headers.get('location') || url, url);
    // An ordinary login link in the navigation is not an access wall.
    const login = location.pathname === '/login-required';
    const challenge = /captcha|verifycenter|secsdk-captcha|安全验证|访问验证|EO_Bot_Ssid|__tst_status/i.test(markup);
    const blocked = login || challenge || [401,403,429].includes(response.status);
    const reason = login ? 'login_required' : challenge ? 'access_challenge' : `http_${response.status}`;
    const health: SourceRunHealth = { ok: false, blocked, httpStatus: response.status,
      contentType: response.headers.get('content-type') || '', checkedAt: new Date().toISOString(),
      message: `dongchedi_live_${reason}:bytes=${markup.length}` };
    if (blocked) return { items: [], finished: true, nextCursor: null, health };
    if (!response.ok) throw new Error(health.message);
    const items = parseDongchediPublicListings(markup);
    if (!items.length) throw new Error(`dongchedi_public_listing_schema_unrecognized:status=${response.status}:bytes=${markup.length}`);
    return { items, finished: false, nextCursor: String(page + 1), count: items.length,
      health: { ...health, ok: true, message: `dongchedi_public_structured_listings:${items.length}` } };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as any, url = detailUrl(row?.url || row?.['@id']);
    const types = Array.isArray(row?.['@type']) ? row['@type'] : [row?.['@type']];
    const make = label(row?.brand), model = label(row?.model);
    const year = Number(row?.vehicleModelDate);
    const quote = Array.isArray(row?.offers) ? row.offers.length === 1 ? row.offers[0] : null : row?.offers;
    const price = Number(quote?.price);
    if (!types.some((type:unknown) => ['Car','Vehicle'].includes(String(type))) || !url || !make || !model || !Number.isInteger(year) || year < 1990 || year > new Date().getUTCFullYear()+1
      || quote?.priceCurrency !== 'CNY' || !Number.isFinite(price) || price <= 0) return null;
    if (quote.url && detailUrl(quote.url)?.pathname !== url.pathname) return null;
    const sourceOfferId = url.pathname.split('/').filter(Boolean).pop()!;
    const images = (Array.isArray(row.image) ? row.image : [row.image]).map((image:any) => typeof image === 'string' ? image : image?.contentUrl)
      .filter((image:any) => typeof image === 'string' && /^https:\/\//.test(image));
    const now = new Date().toISOString();
    return { id: stableOfferId(this.sourceId, sourceOfferId), sourceId: this.sourceId, sourceOfferId,
      market: this.market, offerType: 'fixed', status: this.mapStatus(raw), make, model, trim: label(row.name), year,
      sourcePrice: price, sourceCurrency: 'CNY', priceMode: 'fixed', calculationStatus: 'needs_data', totalRub: null,
      images: [], firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: url.toString(), raw: row, exactDetail: false,
        photoIdentityVerified: images.length > 0, gallerySafetyMode: 'dongchedi_listing_jsonld_bound',
        sourceImageUrls: images } } as VehicleOffer;
  }
  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    if (!detailUrl(offer.operational?.sourceUrl)) throw new Error('dongchedi_invalid_detail_url');
    const raw = offer.operational?.raw as any;
    const normalized = this.normalizeOffer(raw);
    if (normalized?.sourceOfferId !== offer.sourceOfferId) throw new Error('dongchedi_listing_identity_mismatch');
    return [...new Set((normalized.operational as any).sourceImageUrls as string[])].slice(0,30)
      .map(url => ({id:'',url,objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
  }
  mapStatus(raw: unknown): OfferStatus {
    const offers = (raw as any)?.offers;
    const quote = Array.isArray(offers) ? offers[0] : offers;
    return /SoldOut|OutOfStock|Discontinued/i.test(String(quote?.availability || '')) ? 'sold' : 'active';
  }
  async healthCheck(): Promise<SourceRunHealth> {
    try { return (await this.fetchPage()).health!; }
    catch (error) { return {ok:false,message:String(error),checkedAt:new Date().toISOString()}; }
  }
}
export const dongchediPublicSource = new DongchediPublicSource();
