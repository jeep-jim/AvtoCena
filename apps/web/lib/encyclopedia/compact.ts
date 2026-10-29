import {numberFields,displayValue,type Variant,type ModelRecord} from './schema';
// Equipment names and provenance do not split the visible mechanical rows.
// Original records and evidence are retained, including conflicting values.
export const mechanicalFields=['year','chassisCode','bodyType','fuel','powertrainKind','transmission','drive','engineCode',...numberFields.filter(k=>k!=='year')] as const;
// Normalize only documented presentation aliases; unknown text and exact codes
// stay distinct. Certification and generation identity must never disappear.
const identityFields=['generation','motors30MinKw'] as const;
const aliases=new Set(['bodyType','fuel','powertrainKind','transmission','drive']);
const value=(row:Variant,field:string)=>{const v=(row as any)[field];if(v===undefined||v===null||v==='')return null;return typeof v==='string'?(aliases.has(field)?displayValue(v.trim()).toLocaleLowerCase('ru'):v.trim()):v;};
const identity=(row:Variant)=>JSON.stringify([...identityFields.map(f=>value(row,f)),...['approval','approvalCH','type','variant','version'].map(f=>(row.astraIdentity as any)?.[f]||null)]);
const protectedFields=['power30MinKw','frontMotor30MinKw','rearMotor30MinKw'] as const;
export function mechanicalRows(variants:Variant[]):Variant[]{
 const groups=new Map<string,Variant>();
 for(const row of variants){
  const key=JSON.stringify([identity(row),...mechanicalFields.map(field=>value(row,field))]);
  const old=groups.get(key);
  if(!old||Boolean(row.manualEditedAt)&&!old.manualEditedAt||row.status==='verified'&&old.status!=='verified'&&!old.manualEditedAt)groups.set(key,row);
 }
 const rows=[...groups.values()];
 const byYear=new Map<number|undefined,Variant[]>();
 for(const row of rows){const sameYear=byYear.get(row.year)||[];sameYear.push(row);byYear.set(row.year,sameYear);}
 // A non-manual partial observation can share a single more complete row only
 // when at least two independent facts match. Ambiguous alternatives stay visible.
 // This changes presentation only: no synthetic record or stored fact is created.
 return rows.filter(row=>{
  if(row.manualEditedAt||row.status==='verified'||!row.year)return true;
  const sameYear=byYear.get(row.year)!;
  // Large years retain exact grouping only; never add quadratic work to a
  // manifest rebuild or discard records to meet a presentation budget.
  if(sameYear.length>128)return true;
  const candidates=sameYear.filter(other=>{
   if(other===row||other.year!==row.year||identity(other)!==identity(row))return false;
   if(protectedFields.some(f=>value(row,f)!==value(other,f)))return false;
   let more=false,anchors=0;
   for(const field of mechanicalFields){
    const a=value(row,field),b=value(other,field);
    if(a!==null&&a!==b)return false;
    if(a===null&&b!==null)more=true;
    if(a!==null&&a===b&&['engineCc','powerHp','fuel','drive','transmission','bodyType','engineCode','chassisCode'].includes(field))anchors++;
   }
   return more&&anchors>=2;
  });
  return candidates.length!==1;
 }).sort((a,b)=>(b.year||0)-(a.year||0)||(a.engineCc||0)-(b.engineCc||0)||(a.powerHp||0)-(b.powerHp||0));
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
