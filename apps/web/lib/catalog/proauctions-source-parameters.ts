import type { VehicleOffer } from './types';

function snapshotFor(offer: VehicleOffer) {
  const snapshot=offer.operational?.sourceSpecifications;
  return offer.market==='japan' && offer.sourceId==='proauctions_japan_stat'
    && snapshot?.sourceId===offer.sourceId && snapshot.sourceOfferId===offer.sourceOfferId
    && snapshot.sourceUrl===offer.operational.sourceUrl
    && /^https:\/\/demo\.pro-auctions\.ru\/statistika\/[^/]+\/[^/]+\/\d+\.html$/.test(snapshot.sourceUrl)
    ? snapshot : undefined;
}
function value(offer:VehicleOffer,label:RegExp) {
  const values=[...new Set(snapshotFor(offer)?.groups.flatMap(g=>g.items).filter(i=>label.test(i.name)).map(i=>i.value.trim()) || [])];
  return values.length===1?values[0]:'';
}
/** Repair the legacy default confidence only when the source attestation and table agree. */
export function restoreProAuctionsPower<T extends VehicleOffer>(offer:T):T {
  const raw=value(offer,/^Мощность(?: ДВС)?$/i);
  const hp=Number(raw.match(/(\d+(?:[.,]\d+)?)\s*л\.\s*с\./i)?.[1]?.replace(',','.'));
  const kw=Number(raw.match(/(\d+(?:[.,]\d+)?)\s*кВт/i)?.[1]?.replace(',','.'));
  const evidence:any=offer.operational?.semanticEvidence || {};
  if (!hp || !kw || Math.abs(hp-kw/0.73549875)>Math.max(2,hp*.015)
    || evidence.powerHp?.status!=='exact' || Number(evidence.powerHp.value)!==hp
    || evidence.powerHp.source!==offer.operational?.sourceUrl
    || ['conflict','ambiguous'].includes(evidence.powerKw?.status)
    || Number(offer.powerHp)!==hp || Math.abs(Number(offer.powerKw)-kw)>0.1
    || (offer.operational?.powerSanity as any)?.rejected) return offer;
  return {...offer,powerDataConfidence:'source_exact',powerDataSource:offer.operational.sourceUrl};
}
/** Auction volume may be rounded: use it in the labelled editable estimate, never certify it. */
export function proAuctionsReportedVolume(offer:VehicleOffer):number | undefined {
  const semantic:any=offer.operational?.semanticEvidence;
  if (offer.engineCc || offer.powertrainKind==='electric' || semantic?.engineCc?.status==='conflict')return undefined;
  const raw=value(offer,/^Объ[её]м,\s*см[³3]$/i);
  const cc=/^\d{3,5}$/.test(raw)?Number(raw):0;
  return cc>=300 && cc<=10000 && Number(semantic?.engineCc?.value)===cc ? cc : undefined;
}
