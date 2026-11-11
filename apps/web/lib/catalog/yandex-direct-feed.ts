import { offerPath } from './offer-url';
import { isGreenCornerOffer } from './green-corner-contract';
import { isConfirmedSourceWithdrawn } from './confirmed-source-withdrawals';
import type { VehicleOffer } from './types';

export const DIRECT_CITY = 'Новокузнецк';
export const DIRECT_FEED_META = 'catalog/advertising/yandex/current.json';
export const DIRECT_MARKETS = ['china', 'korea', 'uae', 'georgia', 'europe', 'green'] as const;
export type DirectMarket = typeof DIRECT_MARKETS[number];
export const DIRECT_FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type DirectFeedMetadata = {version:1;generatedAt:string;generationId:string;greenUpdatedAt:string;city:string;files:Record<string,{path:string;count:number;bytes:number;sha256:string}>};
export function directMarket(offer: VehicleOffer): DirectMarket | undefined {
  if (isGreenCornerOffer(offer)) return 'green';
  return DIRECT_MARKETS.includes(offer.market as DirectMarket) ? offer.market as DirectMarket : undefined;
}
export function directOfferEligible(offer: VehicleOffer, now = Date.now()) {
  const updated = Date.parse(offer.updatedAt);
  return Boolean(directMarket(offer) && offer.status === 'active' && offer.offerType === 'fixed'
    && offer.catalogKind !== 'auction_result' && !offer.auctionResult && offer.priceMode !== 'auction_start'
    && !isConfirmedSourceWithdrawn(offer) && offer.make?.trim() && offer.model?.trim()
    && Number.isInteger(offer.year) && offer.year >= 1950 && offer.year <= new Date(now).getUTCFullYear()+1
    && Number.isFinite(updated) && updated <= now + 86400000 && now-updated <= 7*86400000
    && (!offer.expiresAt || Date.parse(offer.expiresAt)>now));
}
export function xmlText(value: unknown) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
export function directOfferXml(offer: VehicleOffer, totalRub: number, images: string[]) {
  if (!Number.isFinite(totalRub) || totalRub <= 0) return null;
  const photos = [...new Set(images)].filter(value=>{try {const u=new URL(value,'https://avtocena.com');return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}).slice(0,10);
  if (!photos.length) return null;
  const tag=(key:string,value:unknown)=>`<${key}>${xmlText(value)}</${key}>`;
  return '<car>' + [tag('unique_id',offer.id),tag('mark_id',offer.make),tag('folder_id',offer.model),
    ...(offer.trim ? [tag('modification_id',offer.trim)] : []),tag('year',offer.year),
    ...(Number.isInteger(offer.mileageKm)&&Number(offer.mileageKm)>0?[tag('run',offer.mileageKm)]:[]),
    tag('url',`https://avtocena.com${offerPath(offer)}?direct=novokuznetsk`),
    tag('price',Math.round(totalRub)),tag('currency','RUB'),tag('availability','на заказ'),
    '<images>'+photos.map(url=>tag('image',new URL(url,'https://avtocena.com').href)).join('')+'</images>',
    tag('custom_label_0',directMarket(offer)),tag('custom_label_1',DIRECT_CITY),
    tag('custom_label_2','Под ключ, доставка включена'),
  ].join('')+'</car>';
}
export function directFeedXml(cars: string[]) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<data><cars>\n'+cars.join('\n')+'\n</cars></data>\n';
}
