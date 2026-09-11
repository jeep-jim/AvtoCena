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

/** Prefill a pickup scenario only from an explicit total mass, never curb weight. */
export function enrichOfferWithSourceTableParameters<T extends VehicleOffer>(input:T):T {
  const offer=enrichOfferWithSourceTableDisplacement(input);
  const snapshot=offer.operational?.sourceSpecifications;
  const evidence:any=offer.operational?.semanticEvidence || {};
  const pickup=/pickup|pick-up|пикап|皮卡|픽업/i.test(String(offer.bodyType||""));
  if (!pickup || (offer.vehicleCategory && offer.vehicleCategory !== "unknown" && offer.vehicleCategory !== "N1")
    || String(offer.tnVedCode||"").startsWith("8703")
    || evidence.grossVehicleWeightKg?.status === "conflict" || evidence.vehicleCategory?.status === "conflict") return offer;
  let mass=Number(offer.grossVehicleWeightKg)||0;
  if (!mass && snapshot?.sourceId === offer.sourceId && snapshot?.sourceOfferId === offer.sourceOfferId) {
    const values:number[]=[];
    for (const group of snapshot.groups) for (const item of group.items) {
      const label=item.name.normalize("NFKC");
      if (!/最大允许总质量|最大总质量|总质量|차량총중량|총중량|полная.*масса|разреш[её]нная.*масса|gross.*(?:weight|mass)|gvwr/i.test(label)) continue;
      if (!/kg|кг|킬로그램|千克/i.test(label)) continue;
      const raw=item.value.normalize("NFKC").trim().replace(/(?<=\d)[ ,](?=\d{3}(?:\D|$))/g,"");
      if (!/^\d{3,5}(?:\s*(?:kg|кг|킬로그램|千克))?$/i.test(raw)) continue;
      values.push(Number(raw.match(/^\d+/)?.[0]));
    }
    const unique=[...new Set(values)];
    if(unique.length===1)mass=unique[0];
  }
  if (!(mass>=1000 && mass<=3500)) return offer;
  return {...offer,grossVehicleWeightKg:mass,vehicleCategory:"N1"};
}
