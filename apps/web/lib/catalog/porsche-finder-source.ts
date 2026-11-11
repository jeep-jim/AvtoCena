import { stableOfferId } from './storage';
import type { CatalogFetchResult, CatalogSourceAdapter, VehicleOffer } from './types';

type Market = 'uae' | 'georgia';
const REGIONS = { uae: { path: '/xa/en-XA', currency: 'AED' }, georgia: { path: '/ge/en-GE', currency: 'EUR' } };
const ORIGIN = 'https://finder.porsche.com';
const clean = (value: unknown) => String(value ?? '').trim();
const number = (value: unknown) => Number(clean(value).replace(/,/g, ''));

// Decode JSON carried by React Flight; never evaluate source JavaScript.
function pageRecords(markup: string) {
  const chunks: string[] = [];
  for (const match of markup.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)) {
    try { chunks.push(JSON.parse(match[1])[1]); } catch {}
  }
  const records: any[] = [];
  const visit = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 30) return;
    if (value.listingId && value.meta && value.sections) records.push(value);
    for (const child of Object.values(value)) visit(child, depth + 1);
  };
  for (const line of chunks.join('').split('\n')) {
    try { visit(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch {}
  }
  return records;
}

export function porscheFinderDetail(markup: string, sourceUrl: string, market: Market): VehicleOffer | null {
  const region = REGIONS[market];
  const url = new URL(sourceUrl);
  if (url.origin !== ORIGIN || !url.pathname.startsWith(`${region.path}/details/`)) return null;
  const id = url.pathname.match(/(?:-|\/)([A-Z0-9]{6})$/)?.[1];
  if (!id) return null;
  const records = pageRecords(markup).filter(record => record.listingId === id);
  if (records.length !== 1) return null;
  const record = records[0], meta = record.meta, sections = record.sections;
  if (record.listed !== true || sections.title?.subtitle?.reserved === true) return null;
  if (meta.detailsUrl !== `${ORIGIN}${url.pathname}` || meta.priceCurrency !== region.currency) return null;
  // Cross-check the independently emitted offer identity and price, excluding
  // related vehicles, finance instalments and a different regional storefront.
  const products: any[] = [];
  for (const match of markup.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { const item = JSON.parse(match[1]); if ([item['@type']].flat().includes('Car')) products.push(item); } catch {}
  }
  if (products.length !== 1) return null;
  const product = products[0];
  if (product.offers?.url !== meta.detailsUrl || product.offers?.availability !== 'https://schema.org/InStock'
    || product.offers?.priceCurrency !== meta.priceCurrency || number(product.offers?.price) !== number(meta.priceValue)
    || product.brand?.name !== 'Porsche' || product.vehicleIdentificationNumber !== meta.vin) return null;
  // This first adapter accepts combustion cars only. Peak EV/hybrid power is
  // not a substitute for certified 30-minute power required by the calculator.
  const fuel = meta.engineType === 'PETROL' ? 'petrol' : meta.engineType === 'DIESEL' ? 'diesel' : null;
  if (!fuel || product.vehicleEngine?.fuelType !== meta.engineType) return null;
  const engine = sections.technicalData?.technicalData?.filter((group: any) => group.key === 'engine');
  if (!Array.isArray(engine) || engine.length !== 1) return null;
  const values = (label: string) => engine[0].items.filter((item: any) => item.label === label).map((item: any) => clean(item.value));
  const displacements = values('Displacement');
  const powers = values('Maximum power combustion engine');
  if (displacements.length !== 1 || powers.length !== 1) return null;
  const cc = displacements[0].match(/^(\d{1,3}(?:,\d{3})*|\d+) cm³(?: \/ \d+(?:\.\d+)? l)?$/);
  const power = powers[0].match(/^(\d+(?:\.\d+)?) kW \/ (\d+(?:\.\d+)?) hp$/);
  if (!cc || !power) return null;
  const engineCc = number(cc[1]), powerKw = number(power[1]), powerHp = number(power[2]);
  if (engineCc < 300 || engineCc > 10000 || powerHp < 20 || powerHp > 2500 || Math.abs(powerKw - powerHp * 0.73549875) > 1) return null;
  const summaryPower = sections.summary?.characteristics?.filter((item: any) => item.title === 'Maximum power combustion engine');
  if (summaryPower?.length !== 1 || clean(summaryPower[0].value) !== powers[0]) return null;
  const year = number(meta.modelYear);
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear() + 1
    || number(clean(product.vehicleModelDate).slice(0, 4)) !== year) return null;
  const sourcePrice = number(meta.priceValue);
  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0) return null;
  const gallery = sections.gallery;
  if (gallery?.imagesType !== 'real' || !Array.isArray(gallery.images)) return null;
  const images = [...new Set<string>(gallery.images.filter((item: any) => /^[a-f0-9-]{36}$/.test(clean(item.id)))
    .map((item: any) => `https://images.finder.porsche.com/${item.id}/960`))];
  if (images.length < 5 || !images.includes(meta.imageUrl) || product.image !== meta.imageUrl) return null;
  const sourceId = `porsche_finder_${market}_public`;
  const now = new Date().toISOString();
  const exact = (value: unknown) => ({ source: 'porsche_finder_same_listing', value, rawValues: [String(value)], status: 'exact' });
  return {
    id: stableOfferId(sourceId, id), sourceId, sourceOfferId: id, market, offerType: 'fixed', status: 'active',
    make: 'Porsche', model: clean(meta.modelCategory), trim: clean(meta.title), sourceTitle: clean(sections.title?.title), year,
    // First registration and model year do not prove an exact production date.
    productionDate: /^\d{4}-\d{2}-\d{2}$/.test(clean(meta.productionDate)) ? meta.productionDate : undefined,
    mileageKm: meta.mileage?.unitCode === 'KMT' ? number(meta.mileage.value) : undefined,
    engineCc, powerHp, powerKw, fuel, powertrainKind: 'combustion', powerDataConfidence: 'source_exact',
    powerDataSource: 'porsche_finder_same_listing_engine_table',
    transmission: /automatic/i.test(meta.transmission) ? 'automatic' : /manual/i.test(meta.transmission) ? 'manual' : undefined,
    drive: ({ ALL_WHEEL_DRIVE: 'awd', REAR_WHEEL_DRIVE: 'rwd', FRONT_WHEEL_DRIVE: 'fwd' } as Record<string, string>)[meta.drivetrain],
    bodyType: clean(meta.bodyType).toLowerCase(), sourcePrice, sourceCurrency: region.currency, priceMode: 'fixed',
    images: images.map(url => ({ id: '', url, objectKey: '', checksum: '', size: 0, mimeType: 'image/jpeg' })),
    totalRub: null, calculationStatus: 'needs_data', firstSeenAt: now, updatedAt: now,
    operational: { sourceUrl: meta.detailsUrl, sourceTitle: clean(sections.title?.title), detailIdentityVerified: true,
      fieldIdentityVerified: true, photoIdentityVerified: true, vehiclePhotoVerified: true,
      sourceExactFields: ['make', 'model', 'trim', 'year', 'engineCc', 'powerHp', 'powerKw', 'fuel', 'sourcePrice', 'sourceCurrency'],
      semanticEvidence: { year: exact(year), engineCc: exact(engineCc), powerHp: exact(powerHp), fuel: exact(fuel) },
      raw: { listingId: id, listingBoundImages: true, photoIdentityVerified: true, detailIdentityVerified: true,
        firstRegistration: meta.firstRegistration, modelYear: year, sellerName: meta.seller?.name,
        technicalDataScope: 'same_listing_factory_specification', imagesType: gallery.imagesType,
        reportedGalleryCount: gallery.totalNumberOfImages, engineDisplacementLabel: displacements[0], enginePowerLabel: powers[0] } },
  };
}

async function pageMarkup(url: string) {
  const response = await fetch(url, { headers: { accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (!response.ok || response.status >= 300) throw new Error(`porsche_finder_http_${response.status}`);
  const markup = await response.text();
  if (/window\.solveChallenge\s*\(|EO-Bot-Js-Token|<title[^>]*>\s*(?:Just a moment|Access Denied)/i.test(markup)) throw new Error('porsche_finder_challenge_stop');
  return markup;
}

class PorscheFinderSource implements CatalogSourceAdapter {
  accessMode = 'public_html' as const;
  sourceId: string;
  constructor(public market: Market) { this.sourceId = `porsche_finder_${market}_public`; }
  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const prefix = REGIONS[this.market].path;
    const markup = await pageMarkup(`${ORIGIN}${prefix}/search?condition=used&page=${page}`);
    const links = [...new Set([...markup.matchAll(/href="([^"]*\/details\/[^"?]+)(?:\?[^" ]*)?"/g)]
      .map(match => new URL(match[1].replace(/&amp;/g, '&'), ORIGIN))
      .filter(url => url.origin === ORIGIN && url.pathname.startsWith(`${prefix}/details/`)).map(url => url.href))];
    const items: VehicleOffer[] = [];
    let failedDetailRows = 0;
    let attemptedDetailRows = 0;
    let stopReason = "";
    for (const url of links.slice(0, 20)) {
      attemptedDetailRows += 1;
      try {
        const offer = porscheFinderDetail(await pageMarkup(url), url, this.market);
        if (offer) items.push(offer);
      } catch (error) {
        failedDetailRows += 1;
        if (/http_(401|403|429)|challenge|pilot_/.test(String(error))) { stopReason = String(error); break; }
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const hasNext = !stopReason && markup.includes(`page=${page + 1}`);
    return { items, count: items.length, nextCursor: hasNext ? String(page + 1) : null, finished: !hasNext,
      diagnostics: { listingRows: links.length, rejectedRows: attemptedDetailRows - items.length, failedDetailRows, unexaminedRows: links.length - attemptedDetailRows },
      health: { ok: items.length > 0 && !stopReason, checkedAt: new Date().toISOString(), message: `Porsche Finder ${this.market}: ${items.length}/${links.length}${stopReason ? `; stopped: ${stopReason}` : ""}` } };
  }
  normalizeOffer(raw: unknown) { const offer = raw as VehicleOffer; return offer?.sourceId === this.sourceId ? offer : null; }
  async fetchImages(offer: VehicleOffer) { return offer.images; }
  async healthCheck() {
    try { const page = await this.fetchPage('1'); return page.health!; }
    catch (error) { return { ok: false, checkedAt: new Date().toISOString(), message: String(error) }; }
  }
  mapStatus() { return 'active' as const; }
}
export const porscheFinderUaeSource = new PorscheFinderSource('uae');
export const porscheFinderGeorgiaSource = new PorscheFinderSource('georgia');
