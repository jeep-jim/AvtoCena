import type { VehicleOffer } from './types';

/** Recover exact displacement from a retained, listing-bound engine table. */
export function enrichOfferWithSourceTableDisplacement<T extends VehicleOffer>(offer:T):T {
  if (Number(offer.engineCc) > 0 || offer.fuel === 'electric' || offer.powertrainKind === 'electric') return offer;
  const snapshot=offer.operational?.sourceSpecifications;
  const semantic:any=offer.operational?.semanticEvidence || {};
  if (semantic.engineCc?.status === 'conflict' || !snapshot || snapshot.sourceId !== offer.sourceId || snapshot.sourceOfferId !== offer.sourceOfferId) return offer;
  const candidates:number[]=[];
  const labels:string[]=[];
  for(const group of snapshot.groups) {
    const engineGroup=/^(?:发动机|엔진|двигатель|engine)(?:\s|$|参数)/i.test(group.name.trim());
    for(const item of group.items) {
      const label=item.name.normalize('NFKC').trim();
      const named=/(?:排量|배기량|рабочий объ[её]м|объ[её]м двигателя|engine displacement|engine capacity|displacement)/i.test(label);
      const ccUnit=/(?:m[lL]|cc|cm3|см3|см³|cm³|毫升)/i.test(label);
      // Some source exports retain only '(mL)'. Accept it only inside the engine group.
      if (!(named && ccUnit) && !(engineGroup && /^\(?\s*(?:ml|cc|cm3|cm³)\s*\)?$/i.test(label))) continue;
      const raw=item.value.normalize('NFKC').trim();
      if (!/^\d{3,5}(?:\s*(?:ml|cc|cm3|cm³|см3|см³))?$/i.test(raw)) continue;
      const n=Number(raw.match(/^\d+/)?.[0]);
      if(n>=300 && n<=10000){candidates.push(n);labels.push(`${group.name}: ${item.name} = ${item.value}`);}
    }
  }
  const values=[...new Set(candidates)];
  if(values.length!==1)return offer;
  return {...offer,engineCc:values[0],operational:{...offer.operational,semanticEvidence:{...semantic,
    engineCc:{status:'exact',value:values[0],source:`source_table:${snapshot.sourceId}:${snapshot.sourceOfferId}:${snapshot.specificationId}`,rawValues:labels}}}};
}
