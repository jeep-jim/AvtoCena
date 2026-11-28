import type {AjesSourceSelection} from './japan-source-selection';
import {pickupSourceCandidateSql} from './pickup-body';
import {heavyVehicleFamilies} from './heavy-vehicle-families';

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const sourceName=(value:unknown):value is string=>typeof value==='string'&&/^[\p{L}\p{N} .+()&/_-]{1,80}$/u.test(value)&&value.trim()===value;
const powerRange=(from:unknown,to:unknown)=>Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&Number(from)>=1&&Number(to)<=2500&&Number(from)<=Number(to);
const orderedStrings=(items:string[])=>[...new Set(items)].sort();
const encodedLength=(value:string)=>new URLSearchParams({sql:value}).toString().length;


const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
const literal=(value:unknown)=>{if(!sourceName(value))throw Error('ajes_invalid_query');return `'${value}'`;};
/** A compact source candidate exclusion using only exact existing family names.
 * Suffixed families may enter a raw page; ajesLot still applies the complete
 * heavy-vehicle admission guard. This broader scope needs its own cache key.
 */
export function japanSourceSelectionHeavySqlExclusion():string {
 const groups=new Map<string,{makes:string[];models:readonly string[]}>();
 for(const group of heavyVehicleFamilies){
  const key=group.models.join('|'),saved=groups.get(key)||{makes:[],models:group.models};
  saved.makes.push(group.make);groups.set(key,saved);
 }
 return [...groups.values()].map(group=>`not (marka_name in (${group.makes.map(literal).join(',')}) and model_name in (${group.models.map(literal).join(',')}))`).join(' and ');
}
function yearsSql(years:number[]):string {
 if(years.length===1)return `year=${years[0]}`;
 const list=`year in (${years.join(',')})`,range=`year>=${years[0]} and year<=${years[years.length-1]}`;
 return years[years.length-1]-years[0]===years.length-1&&range.length<list.length?range:list;
}
function modelSql(rows:unknown,annual:boolean):string[] {
 if(!Array.isArray(rows))throw Error('ajes_invalid_query');
 const grouped=new Map<string,{make:string;years?:number[];models:string[]}>();
 for(const row of rows){
  if(!record(row)||!exactKeys(row,annual?['make','model','years']:['make','model'])||!sourceName(row.make)||!sourceName(row.model))throw Error('ajes_invalid_query');
  const years=annual?row.years:undefined;
  if(annual&&(!Array.isArray(years)||!years.length||years.some(year=>!Number.isInteger(year)||year<2008||year>2100)))throw Error('ajes_invalid_query');
  const sortedYears=Array.isArray(years)?[...new Set(years)].sort((a,b)=>a-b):undefined;
  const key=JSON.stringify([row.make,sortedYears]),group=grouped.get(key)||{make:row.make,years:sortedYears,models:[]};
  group.models.push(row.model);grouped.set(key,group);
 }
 const exact=[...grouped.values()].map(group=>{
  const models=orderedStrings(group.models);
  return `(marka_name=${literal(group.make)} and ${models.length===1?`model_name=${literal(models[0])}`:`model_name in (${models.map(literal).join(',')})`}`
   +(group.years?` and ${yearsSql(group.years)}`:'')+')';
 }).sort();
 // The local matcher still checks make/model/year. For the source candidate
 // superset only, repeated exact model spellings can share their exact year
 // set across makes. Never broaden the years, invent names, or alter an outer
 // user-selected make predicate. Make validation above remains mandatory.
 const byYears=new Map<string,{years?:number[];models:string[]}>();
 for(const group of grouped.values()){
  const key=JSON.stringify(group.years)??'',combined=byYears.get(key)||{years:group.years,models:[]};
  combined.models.push(...group.models);byYears.set(key,combined);
 }
 const candidate=[...byYears.values()].map(group=>{
  const models=orderedStrings(group.models);
  return `(${models.length===1?`model_name=${literal(models[0])}`:`model_name in (${models.map(literal).join(',')})`}`
   +(group.years?` and ${yearsSql(group.years)}`:'')+')';
 }).sort();
 return encodedLength(candidate.join(' or '))<encodedLength(exact.join(' or '))?candidate:exact;
}
function idsSql(value:unknown):string[]{
 if(!Array.isArray(value)||value.some(id=>!validId(id)))throw Error('ajes_invalid_query');
 const ids=orderedStrings(value);return ids.length?[ids.length===1?`id='${ids[0]}'`:`id in (${ids.map(id=>`'${id}'`).join(',')})`]:[];
}
const union=(clauses:string[])=>'('+clauses.join(' or ')+')';
export function japanSourceSelectionSql(input:AjesSourceSelection,phase?:'k'|'u'):string {
 if(!record(input)||input.version!==1||!exactKeys(input,['version','power','body'])||!input.power&&!input.body)throw Error('ajes_invalid_query');
 const clauses:string[]=[];
 if(input.power){
  const power=input.power;
  if(!record(power)||!exactKeys(power,['from','to','models','ids','ownerModels'])||!powerRange(power.from,power.to)||!['k','u'].includes(String(phase)))throw Error('ajes_invalid_query');
  idsSql(power.ids);
  let powerModels=power.models,bodyIds:string[]=[];
  if(input.body&&!input.body.sourceBody&&input.body.pickupCandidates===false){
   // Both predicates still apply below. When body can only come from local
   // annual facts or an exact edited ID, irrelevant power-model exceptions
   // cannot add a matching car. Validate both complete sets before narrowing.
   modelSql(power.models,true);modelSql(input.body.models,true);idsSql(input.body.ids);
   const bodyYears=new Map<string,Set<number>>();
   for(const row of input.body.models){const key=JSON.stringify([row.make,row.model]),years=bodyYears.get(key)||new Set<number>();row.years.forEach(year=>years.add(year));bodyYears.set(key,years);}
   powerModels=power.models.flatMap(row=>{const years=row.years.filter(year=>bodyYears.get(JSON.stringify([row.make,row.model]))?.has(year));return years.length?[{...row,years}]:[];});
   // A manual body correction may be outside every body donor model. Keep its
   // ID in K even when PW contradicts the locally documented horsepower.
   bodyIds=input.body.ids;
  }
  const local=[...modelSql(powerModels,true),...idsSql([...power.ids,...bodyIds]),...modelSql(power.ownerModels,false)];
  // Use a zero lower bound for candidates: NFKC/entity spellings can have a
  // numeric prefix of zero, while mixed 1５０ has prefix 1 and normalizes to 150.
  // The unchanged local filter applies power.from and strict integer validity.
  // The PW branch excludes blank, literal zero and legacy comma lists.
  // Other malformed nonempty values remain candidates, never asserted power.
  clauses.push(phase==='k'?union([`(pw>=0 and pw<=${power.to} and pw!='' and pw!='0' and pw not like '%,%')`,...local])
   // A numeric-only unknown predicate would lose 150,200 or 150hp. Keep the
   // broad source scope; the existing local unknown classifier decides U.
   :'(1=1)');
 }else if(phase!==undefined)throw Error('ajes_invalid_query');
 if(input.body){
  const body=input.body;
  if(!record(body)||!exactKeys(body,['models','ids','sourceBody','pickupCandidates'])||typeof body.pickupCandidates!=='boolean')throw Error('ajes_invalid_query');
  const bodyClauses=[...modelSql(body.models,true),...idsSql(body.ids)];
  if(body.sourceBody){
   const source=body.sourceBody;
   if(!record(source)||!exactKeys(source,['field','labels'])||source.field!=='BODY_TYPE'||!Array.isArray(source.labels)||!source.labels.length)throw Error('ajes_invalid_query');
   // The local parser normalizes NFKC/case/internal whitespace. Literal IN
   // cannot prove the same body set from unnormalised wire labels. Preserve
   // every supplied body candidate; the normal local matcher selects its type.
   source.labels.forEach(literal);
   bodyClauses.push("(body_type is not null and body_type!='')");
  }
  if(body.pickupCandidates)bodyClauses.push(pickupSourceCandidateSql(false));
  clauses.push(bodyClauses.length?union(bodyClauses):'(1=0)');
 }
 return clauses.length===1?clauses[0]:'('+clauses.join(' and ')+')';
}
