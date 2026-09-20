import snapshot from '../../../../data/catalog/korea-official-power/snapshot.json';
import {canonicalCatalogBrand} from './brands';
import type {VehicleOffer} from './types';

type RecordRow = typeof snapshot.records[number];
const fuels:Record<string,string>={'휘발유':'petrol','경유':'diesel','LPG':'lpg','CNG':'cng'};
const code=(value:unknown)=>String(value||'').trim().toUpperCase();
export function officialKoreanManufacturerBrand(row:Pick<RecordRow,'manufacturer'|'model'>) {
 const manufacturer=String(row.manufacturer||'').trim(),model=String(row.model||'').trim();
 // The government uses legal manufacturer names. Restrict corporate aliases
 // to explicitly named product families; GM must not make every GMC a Chevrolet.
 if(manufacturer==='한국지엠' && /^(?:CHEVROLET\b|스파크|말리부|트랙스|트레일블레이저)/i.test(model))return 'Chevrolet';
 if(['르노코리아자동차(주)','르노코리아 주식회사'].includes(manufacturer)
   && /^(?:QM6|SM6|XM3|ARKANA|Master|콜레오스)(?:\b|\s|\()/i.test(model))return 'Renault';
 if(manufacturer==='케이지모빌리티' && /^(?:G4\s|MUSSO\b|렉스턴|무쏘|액티언|코란도|토레스|티볼리)/i.test(model))return 'KGM';
 if(manufacturer==='현대' && /^(?:G70|G80|G90|GV60|GV70|GV80)(?:\b|\s|\()/i.test(model))return 'Genesis';
 return canonicalCatalogBrand(manufacturer);
}

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
 const candidates=records.filter(row=>code(row.engineCode)===code(inspection.engineCode)
   && Number(row.engineCc)===Number(offer.engineCc)&&fuels[row.fuel]===offer.fuel
   && officialKoreanManufacturerBrand(row)===canonicalCatalogBrand(offer.make));
 // Encar may label a mild hybrid merely as petrol. A government hybrid record
 // for the same engine must not be hidden by filtering it out before matching.
 if(!candidates.length||candidates.some(row=>row.powertrain!=='내연기관')||!candidates.some(row=>row.releaseYear<=offer.year)
   ||offer.year>Number(snapshot.capturedAt.slice(0,4)))return null;
 const outputs=candidates.map(row=>{
  const match=String(row.output||'').match(/^\s*(\d+(?:\.\d+)?)\s*\/[\d\s,.~–-]+$/);
  return match?Number(match[1]):NaN;
 });
 if(outputs.some(hp=>!Number.isFinite(hp)||hp<20||hp>1500)||new Set(outputs).size!==1)return null;
 const powerHp=outputs[0];
 if(Number(offer.powerHp)>0&&Math.abs(Number(offer.powerHp)-powerHp)>0.1)return null;
 const ownDerivedKw=semantic.powerKw?.status==='exact' && semantic.powerKw?.source==='korea_energy_agency_engine_code_ps'
   && semantic.powerKw?.conversion==='PS * 0.73549875' && Number(semantic.powerKw.value)>0;
 const existingKw=ownDerivedKw?Number(semantic.powerKw.value):Number(offer.powerKw);
 if(existingKw>0&&Math.abs(existingKw-powerHp*0.73549875)>0.001)return null;
 return {powerHp,engineCode:code(inspection.engineCode),recordIds:candidates.map(row=>row.id),
   sourceUrl:snapshot.sourceUrl,snapshotSha256:snapshot.rawSha256,capturedAt:snapshot.capturedAt};
}

export function enrichEncarOfficialPower<T extends VehicleOffer>(offer:T):T {
 const match=matchKoreaOfficialPower(offer);if(!match)return offer;
 const semantic:any=offer.operational?.semanticEvidence||{};
 const powerKw=Number((match.powerHp*0.73549875).toFixed(6));
 const source='korea_energy_agency_engine_code_ps';
 const evidence=(value:number)=>({status:'exact',value,source,rawValues:[],unit:'PS',recordIds:match.recordIds});
 return {...offer,powerHp:match.powerHp,powerKw,icePowerKw:powerKw,utilizationPowerKw:powerKw,
   powerDataConfidence:'source_exact',powerDataSource:source,
   operational:{...offer.operational,officialPowerEvidence:match,
    semanticEvidence:{...semantic,powerHp:evidence(match.powerHp),powerKw:{...evidence(powerKw),unit:'kW',conversion:'PS * 0.73549875'}}}} as T;
}
