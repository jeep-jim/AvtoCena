import snapshot from '../../../../data/catalog/korea-official-power/snapshot.json';
import {canonicalCatalogBrand} from './brands';
import type {VehicleOffer} from './types';

type RecordRow = typeof snapshot.records[number];
const fuels:Record<string,string>={'휘발유':'petrol','경유':'diesel','LPG':'lpg','CNG':'cng'};
const code=(value:unknown)=>String(value||'').trim().toUpperCase();

/** A source-bound inspection identifies the engine. Government ratings must
 * agree across ALL matching records, including older and newer versions.
 * A shared engine code with different outputs never yields a guessed rating.
 */
export function matchKoreaOfficialPower(offer:VehicleOffer,records:readonly RecordRow[]=snapshot.records) {
 const inspection=(offer.operational as any)?.inspection;
 if(offer.market!=='korea'||offer.sourceId!=='encar_direct'||offer.powertrainKind!=='combustion'
   ||!['petrol','diesel','lpg','cng'].includes(offer.fuel||'')
   ||!inspection?.identityVerified||inspection.sourceOfferId!==String(offer.sourceOfferId)
   ||inspection.year!==offer.year||!/^[A-Z0-9][A-Z0-9.-]{2,19}$/.test(code(inspection.engineCode)))return null;
 const semantic:any=offer.operational?.semanticEvidence||{};
 if(['fuel','engineCc','powerHp','powerKw'].some(key=>semantic[key]?.status==='conflict'))return null;
 const candidates=records.filter(row=>row.powertrain==='내연기관'
   && code(row.engineCode)===code(inspection.engineCode)
   && Number(row.engineCc)===Number(offer.engineCc)&&fuels[row.fuel]===offer.fuel
   && canonicalCatalogBrand(row.manufacturer)===canonicalCatalogBrand(offer.make));
 if(!candidates.length||!candidates.some(row=>row.releaseYear<=offer.year)
   ||offer.year>Number(snapshot.capturedAt.slice(0,4)))return null;
 const outputs=candidates.map(row=>{
  const match=String(row.output||'').match(/^\s*(\d+(?:\.\d+)?)\s*\/[\d\s,.~–-]+$/);
  return match?Number(match[1]):NaN;
 });
 if(outputs.some(hp=>!Number.isFinite(hp)||hp<20||hp>1500)||new Set(outputs).size!==1)return null;
 const powerHp=outputs[0];
 if(Number(offer.powerHp)>0&&Math.abs(Number(offer.powerHp)-powerHp)>0.1)return null;
 return {powerHp,engineCode:code(inspection.engineCode),recordIds:candidates.map(row=>row.id),
   sourceUrl:snapshot.sourceUrl,snapshotSha256:snapshot.rawSha256,capturedAt:snapshot.capturedAt};
}

export function enrichEncarOfficialPower<T extends VehicleOffer>(offer:T):T {
 const match=matchKoreaOfficialPower(offer);if(!match)return offer;
 const powerKw=Number((match.powerHp*0.73549875).toFixed(6));
 const source='korea_energy_agency_engine_code_ps';
 const evidence=(value:number)=>({status:'exact',value,source,rawValues:[],unit:'PS',recordIds:match.recordIds});
 return {...offer,powerHp:match.powerHp,powerKw,icePowerKw:powerKw,utilizationPowerKw:powerKw,
   powerDataConfidence:'source_exact',powerDataSource:source,
   operational:{...offer.operational,officialPowerEvidence:match,
    semanticEvidence:{...offer.operational?.semanticEvidence,powerHp:evidence(match.powerHp),powerKw:{...evidence(powerKw),unit:'kW',conversion:'PS * 0.73549875'}}}} as T;
}
