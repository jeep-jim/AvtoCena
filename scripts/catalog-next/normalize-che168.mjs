import {createHash} from 'node:crypto';
import {canonicalizeSemanticSourceFields, namedElectrifiedPowertrainKind} from '../../apps/web/lib/catalog/powertrain-safety.ts';
import {retainNamedSpecificationGroups} from '../../apps/web/lib/catalog/source-specifications.ts';

export const CHINA_SOURCE_ID = 'autohome_used_china_open';
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const positive = value => /^\d+(?:\.\d+)?$/.test(text(value)) && Number(value) > 0 && Number.isFinite(Number(value)) ? Number(value) : undefined;
export const chinaOfferId = innerId => createHash('sha256').update(CHINA_SOURCE_ID + ':' + innerId).digest('hex').slice(0, 24);
const missing = (field, value) => ({source: 'auto_api_che168:' + field, status: value === undefined ? 'missing' : 'exact', ...(value === undefined ? {} : {value})});

/** Source mapping only. No admission, encyclopedia lookup, pricing, storage or clock reads. */
export function normalizeChe168Row(row, {schema, observedAt, firstSeenAt = observedAt} = {}) {
  if (schema !== 'auto-api-che168-v2') throw Error('catalog_next_source_unsupported_schema');
  const d = row?.data, innerId = text(row?.inner_id);
  if (!d || typeof d !== 'object' || Array.isArray(d) || !/^\d+$/.test(innerId) || text(d.inner_id) !== innerId)
    return {kind: 'invalid', reason: 'identity_mismatch'};
  let url;
  try { url = new URL(text(d.url)); } catch { return {kind: 'invalid', reason: 'invalid_url'}; }
  if (url.origin !== 'https://www.che168.com' || url.username || url.password
    || !new RegExp('^/dealer/\\d+/' + innerId + '\\.html$').test(url.pathname))
    return {kind: 'invalid', reason: 'url_identity_mismatch'};
  if (!Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(Date.parse(firstSeenAt)))
    throw Error('catalog_next_source_observation_time');

  const warnings = [], sourceUrl = url.origin + url.pathname;
  const make = text(d.mark) || undefined, model = text(d.model) || undefined;
  // A four-digit source year is represented, never admitted by an implicit minimum year.
  const year = /^\d{4}$/.test(text(d.year)) && Number(d.year) > 0 ? Number(d.year) : undefined;
  const price = positive(d.price), trim = text(d.configuration) || undefined;
  for (const [field, value] of Object.entries({make, model, year, price}))
    if (value === undefined) warnings.push('missing_or_invalid_' + field);
  const sourceTitle = text(d.complectation) || [make, model, trim].filter(Boolean).join(' ');
  const fuelLabel = /^электрическ/i.test(text(d.engine_type)) ? 'electric' : text(d.engine_type);
  const fields = canonicalizeSemanticSourceFields({fuel: fuelLabel, transmission: text(d.transmission_type),
    drive: text(d.drive_type), bodyType: text(d.body_type)});
  if (text(d.body_type).includes('/')) fields.bodyType = undefined;
  const named = namedElectrifiedPowertrainKind({...fields, engineType: fuelLabel, make, model, trim, sourceTitle});
  const kind = named || (fields.fuel === 'electric' ? 'electric' : fields.fuel === 'hybrid' ? 'other_hybrid' : fields.fuel ? 'combustion' : 'unknown');
  if (kind === 'other_hybrid' || kind === 'series_hybrid') fields.fuel = 'hybrid';
  if (kind === 'electric') fields.fuel = 'electric';
  const hp = kind === 'combustion' ? positive(d.ice_power_ps) || positive(d.power) : positive(d.power);
  const kw = kind === 'combustion' ? positive(d.ice_power_kw) : undefined;
  const conflict = Boolean(hp && kw && Math.abs(hp - kw * 1.3596216173) > 2);
  const powerHp = conflict ? undefined : hp;
  if (conflict) warnings.push('power_ps_kw_conflict');
  else if (powerHp === undefined) warnings.push('missing_power_hp');
  const mileage = /^\d+$/.test(text(d.km_age)) && Number.isSafeInteger(Number(d.km_age)) ? Number(d.km_age) : undefined;
  const registrationDate = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(text(d.first_registration)) ? text(d.first_registration) : undefined;
  const specId = text(d.specid), table = d.extra?.configuration;
  const groups = /^\d+$/.test(specId) && text(table?.specid) === specId ? retainNamedSpecificationGroups(table.paramtypeitems) : [];
  let rawImages = d.images;
  if (typeof rawImages === 'string') { try { rawImages = JSON.parse(rawImages); } catch { rawImages = []; warnings.push('invalid_image_json'); } }
  const images = [], seen = new Set();
  for (const candidate of Array.isArray(rawImages) ? rawImages : []) {
    try {
      const u = new URL(candidate);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || !/(?:^|\.)autoimg\.cn$/.test(u.hostname)
        || !/^\/escimg\/auto\//.test(u.pathname) || !/\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname)) continue;
      const clean = u.origin + u.pathname;
      if (seen.has(clean)) continue;
      seen.add(clean);
      images.push({id: '', url: clean, objectKey: '', checksum: '', size: 0,
        mimeType: /\.webp$/i.test(u.pathname) ? 'image/webp' : /\.png$/i.test(u.pathname) ? 'image/png' : /\.avif$/i.test(u.pathname) ? 'image/avif' : 'image/jpeg'});
    } catch { /* An invalid gallery entry never changes source inventory completeness. */ }
  }
  const offer = {
    id: chinaOfferId(innerId), sourceId: CHINA_SOURCE_ID, sourceOfferId: innerId,
    market: 'china', offerType: 'fixed', status: 'active', catalogKind: 'listing',
    make, model, trim, sourceTitle, year, inventorySourceDate: registrationDate, mileageKm: mileage,
    ...fields, powertrainKind: kind, color: text(d.color) || undefined,
    powerHp, powerKw: conflict ? undefined : kw, icePowerKw: conflict ? undefined : kw,
    powerDataConfidence: powerHp === undefined ? undefined : 'source_exact',
    powerDataSource: powerHp === undefined ? undefined : 'auto_api_che168_source',
    sourcePrice: price, sourceCurrency: 'CNY', ...(price === undefined ? {} : {priceMode: 'fixed'}),
    images, totalRub: null, calculationStatus: 'needs_data', firstSeenAt, updatedAt: observedAt,
    operational: {sourceUrl, sourceVenueName: 'Che168', sourceTitle, provider: 'auto-api.com',
      registrationDate, exactDetail: true, detailIdentityVerified: true, fieldIdentityVerified: true,
      exactPhotos: images.length > 0, photoIdentityVerified: images.length > 0, galleryVerified: images.length > 0,
      galleryImageCount: images.length, galleryStoredAs: 'json_urls', gallerySafetyMode: 'catalog_next_che168_source_v1',
      ...(groups.length ? {sourceSpecifications: {version: 1, sourceId: CHINA_SOURCE_ID, sourceOfferId: innerId,
        specificationId: specId, sourceUrl, capturedAt: observedAt, groups}} : {}),
      semanticEvidence: {year: missing('year', year), fuel: missing('engine_type', fields.fuel),
        engineCc: missing('exact_displacement_cc', undefined),
        powerHp: {...missing('power_ps', powerHp), ...(conflict ? {status: 'conflict', sourcePs: hp, sourceKw: kw} : {})},
        productionDate: missing('production_date', undefined), certifiedPower: missing('certified_30min_power', undefined)}}
  };
  return {kind: 'offer', offer, warnings};
}
