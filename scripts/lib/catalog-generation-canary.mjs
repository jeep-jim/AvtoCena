import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const jsonHash = value => sha256(JSON.stringify(value));
export const PRODUCTION_INPUTS = ['catalog/manifest.json', 'markets/markets.json', 'fees/exchange-rates.json'];
export const CANARY_TEXT_FEED_KEY = 'catalog/public/feeds/openai-products.csv.gz';

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
  if (key.startsWith(prefix) && ['GET', 'PUT'].includes(method)) {
    if (key.slice(prefix.length) !== CANARY_TEXT_FEED_KEY) assertCanaryJsonKey(key.slice(prefix.length));
    return key;
  }
  throw new Error('canary_object_request_blocked');
}

export function assertCanaryJsonKey(key) {
  if (!/\.json$/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))
    || /(?:^|\/)(?:images|image-source-cache)(?:\/|$)/.test(key)) throw new Error('canary_non_json_or_image_write_blocked');
  return key;
}

export function assertCanaryTextFeed(key, data, mimeType) {
  if (key !== CANARY_TEXT_FEED_KEY || mimeType !== 'application/gzip') throw new Error('canary_binary_write_blocked');
  const text = gunzipSync(data, { maxOutputLength: 2_000_000 }).toString('utf8');
  if (!text.startsWith('\uFEFFid,title,description,link,image_link,availability,price,brand,identifier_exists,')
    || /\u0000|data:image\/|\/api\/catalog\/images\//i.test(text)) throw new Error('canary_invalid_text_feed');
}

export function assertCanarySourceRequest(url, method, market, galleryUrls = new Set()) {
  const host = market === 'korea' ? 'kcar.com' : market === 'europe' ? 'mobile.de' : '';
  if (!host || url.protocol !== 'https:' || url.username || url.password || url.port
    || !(url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('canary_source_host_blocked');
  if (galleryUrls.has(url.href) || /\.(?:jpe?g|png|webp|avif|gif|svg)(?:$|\/)/i.test(url.pathname)
    || /^(?:img|image|images)\./i.test(url.hostname)) throw new Error('canary_image_request_blocked');
  if (method !== 'GET' && !(market === 'korea' && method === 'POST'
    && url.hostname === 'api.kcar.com' && url.pathname === '/bc/search/list/drct')) throw new Error('canary_source_method_blocked');
}

export function assertSourceUrlGallery(images, expectedUrls) {
  if (!Array.isArray(images) || !images.length) throw new Error('canary_source_gallery_missing');
  const urls = images.map(image => {
    const url = new URL(image.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || image.objectKey || image.id || image.checksum || Number(image.size || 0) !== 0
      || /\/api\/catalog\/images\//.test(url.pathname)) throw new Error('canary_stored_image_in_source_url_mode');
    return url.href;
  });
  if (new Set(urls).size !== urls.length || expectedUrls && JSON.stringify(urls) !== JSON.stringify(expectedUrls)) {
    throw new Error('canary_source_gallery_parity_failed');
  }
  return urls;
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
