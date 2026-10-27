import {numberFields,displayValue,type Variant,type ModelRecord} from './schema';
// Equipment names and provenance do not split the visible mechanical rows.
// Original records and evidence are retained, including conflicting values.
export const mechanicalFields=['year','chassisCode','bodyType','fuel','powertrainKind','transmission','drive','engineCode',...numberFields.filter(k=>k!=='year')] as const;
export function mechanicalRows(variants:Variant[]):Variant[]{
 const groups=new Map<string,Variant>();
 for(const row of variants){
  const key=JSON.stringify(mechanicalFields.map(field=>row[field]??null));
  const old=groups.get(key);
  if(!old||Boolean(row.manualEditedAt)&&!old.manualEditedAt||row.status==='verified'&&old.status!=='verified'&&!old.manualEditedAt)groups.set(key,row);
 }
 return [...groups.values()].sort((a,b)=>(b.year||0)-(a.year||0)||(a.engineCc||0)-(b.engineCc||0)||(a.powerHp||0)-(b.powerHp||0));
}
export type CompactSpecs=Partial<Record<'bodyType'|'chassisCode'|'fuel'|'engineCc'|'powerHp'|'drive'|'transmission'|'power30MinKw',string>>;
export function compactSpecs(variants:Variant[]):CompactSpecs{
 const result:CompactSpecs={};
 for(const key of ['bodyType','chassisCode','fuel','engineCc','powerHp','drive','transmission','power30MinKw'] as const){
  const values=[...new Set(variants.map(v=>v[key]).filter(v=>v!==undefined&&v!==''))];
  result[key]=values.length===1&&variants.every(v=>v[key]!==undefined&&v[key]!=='')?displayValue(values[0]):values.length?'Разные':'—';
 }
 return result;
}
export function compactModel(record:ModelRecord){
 const variants=mechanicalRows(record.variants);
 return {all:compactSpecs(variants),years:Object.fromEntries([...new Set(variants.flatMap(v=>v.year?[v.year]:[]))].map(year=>[year,compactSpecs(variants.filter(v=>v.year===year))]))};
}
