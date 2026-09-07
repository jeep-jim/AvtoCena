import crypto from 'node:crypto';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const jsonHash = value => sha256(JSON.stringify(value));
export const PRODUCTION_INPUTS = ['catalog/manifest.json', 'markets/markets.json', 'fees/exchange-rates.json'];

export function canaryPrefix(runId, market) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId) || !['europe', 'korea'].includes(market)) throw new Error('invalid_canary_identity');
  return `catalog/canaries/${runId}/${market}/`;
}

// Only these exact production objects can be read. Writes create diagnostic
// objects beneath a unique prefix; no live manifest, generation or image writes.
export function assertCanaryObjectRequest(url, method, endpoint, bucket, configuredPrefix, prefix) {
  const base = new URL(endpoint);
  const decoded = decodeURIComponent(url.pathname);
  const root = `${base.pathname.replace(/\/$/, '')}/${bucket}/${configuredPrefix ? `${configuredPrefix}/` : ''}`;
  if (url.origin !== base.origin || url.search || !decoded.startsWith(root)) throw new Error('canary_object_request_blocked');
  const key = decoded.slice(root.length);
  if (key.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('canary_object_key_blocked');
  if (method === 'GET' && PRODUCTION_INPUTS.includes(key)) return key;
  if (key.startsWith(prefix) && ['GET', 'PUT'].includes(method)) return key;
  throw new Error('canary_object_request_blocked');
}

export function assertProductionInputsUnchanged(before, after) {
  for (const key of PRODUCTION_INPUTS) {
    if (!before[key]?.found || !after[key]?.found || jsonHash(before[key].value) !== jsonHash(after[key].value)
      || before[key].etag !== after[key].etag) throw new Error(`canary_production_input_changed:${key}`);
  }
}

export function assertStoredCardParity(offer, projection, expected, expectedVersion, visibleRub) {
  const sum = (offer?.calculationSnapshot?.breakdown || []).reduce((total, row) => total + Number(row.amountRub), 0);
  if (!offer || !projection || !expected || offer.id !== expected.id || projection.id !== offer.id
    || visibleRub(offer) !== visibleRub(projection) || visibleRub(offer) !== visibleRub(expected)
    || !(offer.totalRub > 0) || sum !== offer.totalRub
    || offer.calculationSnapshot?.businessConfigVersion !== expectedVersion) throw new Error('canary_stored_card_parity_failed');
  return { id: offer.id, sourceOfferId: offer.sourceOfferId, totalRub: offer.totalRub, cardRub: visibleRub(projection),
    breakdownSumRub: sum, businessConfigVersion: expectedVersion, images: offer.images.length };
}
