import type {CalculationIndex} from '../encyclopedia/calculation-index';
import type {CatalogEditorialIndex} from './editorial';

export type JapanPowerPhase='known'|'unknown';
export type JapanPowerSnapshot={index:CalculationIndex|null;editorial:CatalogEditorialIndex;revision:string};
export type JapanPowerQueryContext={phase:JapanPowerPhase;snapshot:JapanPowerSnapshot};
// These are candidate predicates, never specifications. The existing local
// matcher makes the final decision after all editorial/owner values are applied.
const simplePower="(pw regexp '^[ ]*[0-9]+[ ]*$' and length(trim(pw))<=30 and (pw+0)>0 and (pw+0)<=9007199254740991)";
const normalizedPower="(pw regexp '[^ -~]' or pw like '%&%')";
const normalizedIdentity="(model_name regexp '[^ -~]' or model_name like '%&%')";
// The non-ASCII/encoded branch above already covers the other owner aliases.
const ownerCandidate="model_name regexp '^[ ]*STEP[ ]*W(A)?G(O)?N($|[ -])'";
const positive=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>0;
/** A superset of every annual model that can supply local horsepower. Avoid
 * duplicating trim/chassis consensus or brand aliases in supplier SQL. Ignoring
 * make here deliberately admits extra candidates, and never drops an alias.
 * Unusual encoded/NFKC wire identities take the conservative year-only path.
 */
export function japanLocalPowerCandidates(snapshot:JapanPowerSnapshot,compact=false):string{
 const years=new Set<number>(),models=new Set<string>();let broad=false;
 for(const [key,facts] of Object.entries(snapshot.index?.models||{}))for(const fact of facts){
  if(!positive(fact.values?.powerHp)||!Number.isInteger(fact.year)||fact.year<1900||fact.year>2100)continue;
  years.add(fact.year);
  const model=key.slice(key.indexOf(':')+1);
  if(/^[a-z0-9]{1,80}$/.test(model))models.add(model.toUpperCase());else broad=true;
 }
 const parts=[ownerCandidate];
 if(years.size){
  const ordered=[...years].sort((a,b)=>a-b),year=`year>=${ordered[0]} and year<=${ordered.at(-1)}`;
  // Large private indexes are reduced to a superset, never truncated. The
  // bounded page reader still limits work; this is not a catalogue mirror.
  const pattern=[...models].sort().map(model=>[...model].join('[^A-Z0-9]*')).join('|');
  const family=compact||broad||!pattern?year:`(${year} and (model_name regexp '^[^A-Z0-9]*(${pattern})[^A-Z0-9]*$' or ${normalizedIdentity}))`;
  parts.push(`(${family})`);
 }
 const ids=Object.values(snapshot.editorial.entries).filter(entry=>entry.market==='japan'&&entry.sourceId==='ajes_japan_feed'&&entry.status==='visible')
  .filter(entry=>positive((entry.specifications as any)?.powerHp))
  .filter(entry=>entry.id===`ajes-stats-${entry.sourceOfferId}`&&/^[A-Za-z0-9_-]{1,64}$/.test(entry.sourceOfferId)).map(entry=>entry.sourceOfferId);
 if(ids.length)parts.push(compact?'1=1':`id in (${[...new Set(ids)].sort().map(id=>`'${id}'`).join(',')})`);
 return `(${parts.join(' or ')})`;
}
export function japanPowerCandidateSql(bounds:{powerFrom?:number;powerTo?:number},context:JapanPowerQueryContext,compact=false):string{
 if(context.phase!=='known'&&context.phase!=='unknown')throw Error('ajes_invalid_query');
 if(context.phase==='unknown')return `(pw is null or not ${simplePower})`;
 const low=bounds.powerFrom??1,high=bounds.powerTo;
 // MySQL's numeric coercion intentionally admits false positives ("150,200",
 // fractions, etc.). The strict local scalar parser rejects them from known.
 // This shorter superset keeps ordinary combined filters within the GET budget.
 return `(((pw+0)>=${low}${high!==undefined?` and (pw+0)<=${high}`:''}) or ${normalizedPower} or ${normalizedIdentity} or ${japanLocalPowerCandidates(context.snapshot,compact)})`;
}
