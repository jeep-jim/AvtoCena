import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const INPUT_PATH = process.env.CATALOG_SOURCE_FIELD_AUDIT_OUTPUT || 'catalog-source-field-audit-v1.json';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstValue(rows) {
  return Array.isArray(rows) && rows.length ? rows[0]?.value ?? null : null;
}

function state(value, source, detail = null) {
  if (value == null || value === '') return { state: 'missing', evidence: [] };
  return { state: 'exact', evidence: [{ source, value: String(value), ...(detail ? { detail } : {}) }] };
}

function ambiguous(value, source, detail = null) {
  return { state: 'ambiguous', evidence: value == null ? [] : [{ source, value: String(value), ...(detail ? { detail } : {}) }] };
}

function notApplicable(reason) {
  return { state: 'not_applicable', evidence: [{ source: 'powertrain', value: reason }] };
}

function normalizedFuel(value) {
  const text = clean(value).toLowerCase();
  if (/phev|plug[- ]?in|플러그/.test(text)) return 'phev';
  if (/hybrid|hev|하이브리드/.test(text)) return 'hybrid';
  if (/\belectric\b|\bev\b|전기/.test(text)) return 'electric';
  if (/diesel|디젤|경유/.test(text)) return 'diesel';
  if (/petrol|gasoline|가솔린|휘발유/.test(text)) return 'petrol';
  return null;
}

function vehicleNode(summary) {
  return (summary?.vehicleJsonLd || []).find((row) => row?.offers || row?.bodyType || row?.fuelType) || null;
}

function sensibleVisible(summary, field) {
  const rows = summary?.visibleNamedFieldHits?.[field] || [];
  for (const row of rows) {
    const value = clean(row?.value);
    if (!value) continue;
    if (field === 'make' && (/^(?:that|the|of|s\b)/i.test(value) || value.length > 40)) continue;
    if (field === 'model' && (/^year\b/i.test(value) || /retain value|rivals|used tesla|new car|prices by|ensuring it|given its/i.test(value))) continue;
    return { ...row, value: value.replace(/\s+Number of.*$/i, '').replace(/\s+Trim\s+.*$/i, '').trim() };
  }
  return null;
}

function bobaHero(summary) {
  for (const context of summary?.diagnosticContexts?.koreanPrice || []) {
    const match = clean(context).match(/(\d{2})년\s*(\d{1,2})월식\s+([\d,]+)\s*km\s+(가솔린|휘발유|경유|디젤|하이브리드|전기)\s+([\d,]+)\s*만원/);
    if (match) {
      return {
        shortYear: match[1],
        month: Number(match[2]),
        mileageKm: Number(match[3].replace(/,/g, '')),
        fuel: match[4],
        priceKrw: Number(match[5].replace(/,/g, '')) * 10_000,
        context: clean(context).slice(0, 260),
      };
    }
  }
  return null;
}

function bobaTitle(summary) {
  const match = clean(summary?.title).match(/^((?:19|20)\d{2})\s+([^\s]+)\s+(.+?)\s+중고차(?:\s|$)/);
  return match ? { year: match[1], make: match[2], vehicleName: match[3] } : null;
}

function urlIdentity(url, sourceId) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (sourceId === 'carswitch_uae_candidate') {
      const index = parts.indexOf('used-car');
      if (index >= 0 && parts.length >= index + 5) return {
        make: parts[index + 1].replace(/-/g, ' '),
        model: parts[index + 2].replace(/-/g, ' '),
        year: parts[index + 3],
      };
    }
    if (sourceId === 'cars24_uae_candidate') {
      const match = parsed.pathname.match(/buy-used-([a-z0-9-]+)-([a-z0-9-]+)-((?:19|20)\d{2})-cars-/i);
      if (match) return { make: match[1].replace(/-/g, ' '), model: match[2].replace(/-/g, ' '), year: match[3] };
    }
  } catch {}
  return {};
}

function engineCcState(raw, fuel) {
  if (fuel === 'electric') return notApplicable('electric');
  if (!raw) return { state: 'missing', evidence: [] };
  const text = clean(raw);
  const number = Number(text.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  if (!(number > 0)) return { state: 'missing', evidence: [] };
  if (/\bcc\b|cm3|cm³/i.test(text)) return state(Math.round(number), 'source_bound_engine', text);
  if (/\b(?:l|ℓ|liter|litre)\b/i.test(text)) return state(Math.round(number * 1000), 'source_bound_engine', text);
  return ambiguous(text, 'source_bound_engine', 'source exposes displacement without an explicit unit');
}

function powerHpState(raw) {
  if (!raw) return { state: 'missing', evidence: [] };
  const text = clean(raw);
  const number = Number(text.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.[0] || 0);
  if (!(number > 0)) return { state: 'missing', evidence: [] };
  if (/\b(?:hp|bhp|ps)\b|마력/i.test(text)) return state(number, 'source_bound_power', text);
  if (/\bkw\b/i.test(text)) return state(Math.round(number * 1.3596216173), 'source_bound_power', `${text}; converted from kW`);
  return ambiguous(text, 'source_bound_power', 'power unit is not explicit');
}

function galleryState(summary) {
  const jsonCount = Math.max(0, ...(summary?.vehicleJsonLd || []).map((row) => Number(row?.imageCount || 0)));
  const idCount = Number(summary?.images?.listingIdBoundCount || 0);
  if (jsonCount >= 5) return state(jsonCount, 'vehicle_jsonld_gallery');
  if (idCount >= 5) return state(idCount, 'offer_id_bound_gallery');
  if (jsonCount > 0) return { state: 'partial', evidence: [{ source: 'vehicle_jsonld_gallery', value: String(jsonCount) }] };
  if (idCount > 0) return { state: 'partial', evidence: [{ source: 'offer_id_bound_gallery', value: String(idCount) }] };
  return { state: 'missing', evidence: [] };
}

function prominentCars24Price(summary) {
  const values = [];
  for (const raw of summary?.textFieldHits?.price || []) {
    const match = clean(raw).match(/^AED\s*([\d,.]+)$/i);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ''));
    if (value >= 10_000 && value <= 5_000_000) values.push(value);
  }
  return values[0] || null;
}

export function correctSample(sample) {
  const summary = sample?.first?.summary || {};
  const sourceId = sample?.sourceId;
  const node = vehicleNode(summary);
  const urlFields = urlIdentity(sample?.requestedUrl || summary?.finalUrl || '', sourceId);
  const bTitle = sourceId === 'bobaedream_korea_candidate' ? bobaTitle(summary) : null;
  const bHero = sourceId === 'bobaedream_korea_candidate' ? bobaHero(summary) : null;

  const make = node?.brand
    || firstValue(summary?.scriptLocalFieldHits?.make)
    || bTitle?.make
    || urlFields.make
    || sensibleVisible(summary, 'make')?.value
    || null;
  const model = node?.model
    || firstValue(summary?.scriptLocalFieldHits?.model)
    || bTitle?.vehicleName
    || urlFields.model
    || sensibleVisible(summary, 'model')?.value
    || null;
  const year = node?.vehicleModelDate
    || firstValue(summary?.scriptLocalFieldHits?.year)
    || bTitle?.year
    || urlFields.year
    || null;

  const sourceFuelRaw = node?.fuelType
    || firstValue(summary?.scriptLocalFieldHits?.fuel)
    || bHero?.fuel
    || firstValue(summary?.labelFieldHits?.fuel?.map((row) => ({ value: row.value })))
    || null;
  const fuel = normalizedFuel(sourceFuelRaw);

  let price = node?.offers?.price ?? firstValue(summary?.scriptLocalFieldHits?.price);
  let currency = node?.offers?.priceCurrency ?? firstValue(summary?.scriptLocalFieldHits?.currency);
  let priceState;
  let currencyState;
  if (sourceId === 'bobaedream_korea_candidate' && bHero?.priceKrw) {
    price = bHero.priceKrw;
    currency = 'KRW';
    priceState = state(price, 'listing_hero', bHero.context);
    currencyState = state('KRW', 'listing_hero', '만원 unit');
  } else if (sourceId === 'cars24_uae_candidate' && !price) {
    const diagnostic = prominentCars24Price(summary);
    priceState = diagnostic ? ambiguous(diagnostic, 'visible_price_diagnostic', 'first plausible AED amount; binding to offer not yet proven') : { state: 'missing', evidence: [] };
    currencyState = diagnostic ? state('AED', 'visible_price_diagnostic') : { state: 'missing', evidence: [] };
  } else {
    priceState = state(price, node?.offers?.price ? 'vehicle_jsonld' : 'offer_local_script');
    currencyState = state(currency, node?.offers?.priceCurrency ? 'vehicle_jsonld' : 'offer_local_script');
  }

  const body = node?.bodyType || firstValue(summary?.scriptLocalFieldHits?.body) || null;
  const engineRaw = node?.vehicleEngine?.engineDisplacement
    ?? node?.vehicleEngine?.displacement
    ?? firstValue(summary?.scriptLocalFieldHits?.engine)
    ?? firstValue(summary?.visibleNamedFieldHits?.engine)
    ?? null;
  const powerRaw = node?.vehicleEngine?.enginePower
    ?? node?.vehicleEngine?.horsepower
    ?? node?.vehicleEngine?.power
    ?? firstValue(summary?.scriptLocalFieldHits?.power)
    ?? firstValue(summary?.visibleNamedFieldHits?.power)
    ?? null;

  const certifiedRaw = node?.vehicleEngine?.certifiedPower
    ?? node?.vehicleEngine?.ratedPower
    ?? node?.vehicleEngine?.continuousPower
    ?? firstValue(summary?.scriptLocalFieldHits?.certifiedPower)
    ?? firstValue(summary?.visibleNamedFieldHits?.certifiedPower)
    ?? null;
  const certifiedPower = ['electric', 'hybrid', 'phev'].includes(fuel)
    ? (certifiedRaw ? state(clean(certifiedRaw), 'source_bound_certified_power') : { state: 'missing', evidence: [] })
    : notApplicable(fuel || 'non_electrified');

  const matrix = {
    identity: summary?.sourceOfferId && sample?.repeat?.stable ? state(summary.sourceOfferId, 'stable_detail_url') : { state: 'missing', evidence: [] },
    make: state(make, node?.brand ? 'vehicle_jsonld' : sourceId === 'bobaedream_korea_candidate' ? 'detail_title' : firstValue(summary?.scriptLocalFieldHits?.make) ? 'offer_local_script' : 'canonical_url_or_named_spec'),
    model: state(model, node?.model ? 'vehicle_jsonld' : sourceId === 'bobaedream_korea_candidate' ? 'detail_title_vehicle_name' : firstValue(summary?.scriptLocalFieldHits?.model) ? 'offer_local_script' : 'canonical_url_or_named_spec'),
    year: state(year, node?.vehicleModelDate ? 'vehicle_jsonld' : sourceId === 'bobaedream_korea_candidate' ? 'detail_title' : firstValue(summary?.scriptLocalFieldHits?.year) ? 'offer_local_script' : 'canonical_url'),
    price: priceState,
    currency: currencyState,
    body: state(body, node?.bodyType ? 'vehicle_jsonld' : firstValue(summary?.scriptLocalFieldHits?.body) ? 'offer_local_script' : 'missing'),
    fuel: fuel ? state(fuel, node?.fuelType ? 'vehicle_jsonld' : firstValue(summary?.scriptLocalFieldHits?.fuel) ? 'offer_local_script' : 'named_listing_field', sourceFuelRaw) : { state: 'missing', evidence: [] },
    engineCc: engineCcState(engineRaw, fuel),
    powerHp: powerHpState(powerRaw),
    certifiedPower,
    gallery: galleryState(summary),
  };

  const required = Object.keys(matrix);
  const acceptable = new Set(['exact', 'not_applicable']);
  const missingOrAmbiguous = required.filter((field) => !acceptable.has(matrix[field].state));
  return {
    fields: matrix,
    exactReady: missingOrAmbiguous.length === 0,
    missingOrAmbiguous,
    correctionVersion: 1,
  };
}

function correctSource(row) {
  const deficitCounts = {};
  let stableReachable = true;
  let exactReady = true;
  for (const sample of row.samples || []) {
    const previous = sample?.first?.summary?.fieldMatrix || null;
    const corrected = correctSample(sample);
    if (sample?.first?.summary) {
      sample.first.summary.rawFieldMatrix = previous;
      sample.first.summary.fieldMatrix = corrected;
    }
    stableReachable = stableReachable && Boolean(sample?.repeat?.stable);
    exactReady = exactReady && corrected.exactReady;
    for (const field of corrected.missingOrAmbiguous) deficitCounts[field] = (deficitCounts[field] || 0) + 1;
  }
  row.sourceVerdict = {
    stableReachable,
    exactReady: Boolean((row.samples || []).length) && exactReady,
    sampleCount: (row.samples || []).length,
    deficitCounts,
    classificationDecision: 'deferred',
    reason: exactReady
      ? 'mechanical corrected matrix passed; manual semantic audit still required before classification'
      : 'corrected source-bound completeness is not proven on every audited sample',
  };
}

export function postprocess(payload) {
  if (!payload || payload.productionWrites !== false || payload.classificationMutations !== false || payload.publishAllowedMutations !== false) {
    throw new Error('unsafe_or_invalid_field_audit_payload');
  }
  for (const row of payload.results || []) correctSource(row);
  payload.version = Math.max(3, Number(payload.version || 0));
  payload.postprocessed = true;
  payload.postprocessVersion = 1;
  payload.rawBodiesStored = false;
  payload.classificationMutations = false;
  payload.publishAllowedMutations = false;
  return payload;
}

export async function runPostprocess() {
  const payload = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8'));
  postprocess(payload);
  await fs.writeFile(INPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    version: payload.version,
    postprocessed: payload.postprocessed,
    sources: (payload.results || []).map((row) => ({ sourceId: row.sourceId, sourceVerdict: row.sourceVerdict })),
  }, null, 2));
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  runPostprocess().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
