import references from '../../../../data/catalog/japan-official-displacement/honda-nbox.json';
import type {VehicleOffer} from './types';
/** A model name or rounded auction volume is insufficient: require the exact
 * chassis code in the same listing's retained primary specification table. */
export function enrichJapanOfficialDisplacement<T extends VehicleOffer>(offer:T):T {
 const snapshot=offer.operational?.sourceSpecifications,semantic:any=offer.operational?.semanticEvidence||{};
 if(offer.market!=='japan'||offer.sourceId!=='proauctions_japan_stat'||offer.make!=='Honda'||!/^N[ -]?BOX(?:\s+(?:CUSTOM|JOY))?$/i.test(offer.model)
   ||!snapshot||snapshot.sourceId!==offer.sourceId||snapshot.sourceOfferId!==offer.sourceOfferId||snapshot.sourceUrl!==offer.operational?.sourceUrl
   ||offer.operational?.exactDetail!==true||semantic.engineCc?.status==='conflict'
   ||!['ambiguous','missing'].includes(semantic.engineCc?.status)||Number(offer.engineCc)>0)return offer;
 const raw=[...new Set(snapshot.groups.flatMap(g=>g.items).filter(i=>/^Номер кузова$/i.test(i.name.trim())).map(i=>i.value.trim().toUpperCase()))];
 if(raw.length!==1 || raw[0]!==String(offer.operational?.chassisCode||'').trim().toUpperCase())return offer;
 const match=raw[0].match(/^(?:(?:DBA|6BA|5BA)-)?(JF[3456])(?:-\d{5,9})?$/);if(!match)return offer;
 const reference=references.find(r=>r.chassisCodes.includes(match[1]));
 if(!reference||Number(offer.year)<(Number(match[1].slice(2))<5?2017:2023))return offer;
 const reported=Number(semantic.engineCc?.value);
 if(reported>0 && ![650,658,660].includes(reported))return offer;
 return {...offer,engineCc:reference.engineCc,operational:{...offer.operational,
   officialDisplacementEvidence:{referenceId:reference.id,sourceUrl:reference.sourceUrl,sourceSha256:reference.sourceSha256,chassisCode:match[1],engineCode:reference.engineCode},
   semanticEvidence:{...semantic,engineCc:{status:'exact',value:reference.engineCc,source:reference.sourceUrl,
     rawValues:[String(reported||''),reference.sourceValue+' L'],sourceSha256:reference.sourceSha256,chassisCode:match[1]}}}} as T;
}
