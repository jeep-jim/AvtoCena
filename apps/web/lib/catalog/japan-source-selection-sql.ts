import type {AjesSourceSelection} from './japan-source-selection';
import {pickupSourceCandidateSql} from './pickup-body';
import {heavyVehicleFamilies} from './heavy-vehicle-families';

const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value);
const sourceName=(value:unknown):value is string=>typeof value==='string'&&/^[\p{L}\p{N} .+()&/_-]{1,80}$/u.test(value)&&value.trim()===value;
const powerRange=(from:unknown,to:unknown)=>[from,to].some(value=>value!==undefined)
 &&[from,to].every(value=>value===undefined||Number.isSafeInteger(value)&&Number(value)>=1&&Number(value)<=2500)
 &&(from===undefined||to===undefined||Number(from)<=Number(to));
const orderedStrings=(items:string[])=>[...new Set(items)].sort();
const encodedLength=(value:string)=>new URLSearchParams({sql:value}).toString().length;

/** Internal candidate selection only. Exact heavy family names are inexpensive
 * to exclude with the established IN grammar. Suffixed family names remain
 * candidates and are rejected by the unchanged full ajesLot/admission policy.
 * This weaker raw scope must never share the full heavy predicate's cache key. */
export function japanSourceHeavyCandidateSql():string {
 const groups=new Map<string,{makes:string[];models:readonly string[]}>();
 for(const group of heavyVehicleFamilies){
  const key=group.models.join('|'),saved=groups.get(key)||{makes:[],models:group.models};
  saved.makes.push(group.make);groups.set(key,saved);
 }
 return [...groups.values()].map(group=>`not (marka_name in (${group.makes.map(make=>`'${make}'`).join(',')}) and model_name in (${group.models.map(model=>`'${model}'`).join(',')}))`).join(' and ');
}

const exactKeys=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
const literal=(value:unknown)=>{if(!sourceName(value))throw Error('ajes_invalid_query');return `'${value}'`;};
function yearsSql(years:number[]):string {
 if(years.length===1)return `year=${years[0]}`;
 const list=`year in (${years.join(',')})`,range=`year>=${years[0]} and year<=${years[years.length-1]}`;
 return years[years.length-1]-years[0]===years.length-1&&range.length<list.length?range:list;
}
function modelSql(rows:unknown,annual:boolean,mode=0):string[] {
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
 if(!grouped.size)return [];
 if(mode===7)return ['(1=1)'];
 // The directory parser trims only the edges of raw names. LIKE around the
 // validated spelling retains those edges without assuming a new SQL function.
 // Source '_' wildcards only broaden candidates; local identity stays exact.
 const pattern=(column:string,value:string)=>`${column} like '%${value}%'`;
 const namesSql=(models:string[])=>{
  const clauses=models.map(model=>pattern('model_name',model));
  return clauses.length===1?clauses[0]:'('+clauses.join(' or ')+')';
 };
 if(mode===0)return [...grouped.values()].map(group=>`(${pattern('marka_name',group.make)} and ${namesSql(orderedStrings(group.models))}`
  +(group.years?` and ${yearsSql(group.years)}`:'')+')').sort();
 const byYears=new Map<string,{years?:number[];models:string[]}>();
 for(const group of grouped.values()){
  const key=JSON.stringify(group.years)??'',combined=byYears.get(key)||{years:group.years,models:[]};
  combined.models.push(...group.models);byYears.set(key,combined);
 }
 if(mode===1)return [...byYears.values()].map(group=>`(${namesSql(orderedStrings(group.models))}`
  +(group.years?` and ${yearsSql(group.years)}`:'')+')').sort();
 // If the full correspondence cannot fit, retain every model as a broader
 // candidate. Prefixes are literal code-point prefixes of actual directory
 // names, never an invented alias. No cohort is truncated to meet the budget.
 const prefixLength=mode>=3?7-mode:undefined;
 const models=orderedStrings([...grouped.values()].flatMap(group=>group.models)
  .map(model=>prefixLength===undefined?model:Array.from(model).slice(0,prefixLength).join('')));
 const subsumed=models.filter(model=>!models.some(other=>other!==model&&model.includes(other)));
 const years=annual?[...new Set([...grouped.values()].flatMap(group=>group.years!))].sort((a,b)=>a-b):undefined;
 return ['('+namesSql(subsumed)+(years?` and ${yearsSql(years)}`:'')+')'];
}
function idsSql(value:unknown):string[]{
 if(!Array.isArray(value)||value.some(id=>!validId(id)))throw Error('ajes_invalid_query');
 // Editorial lookup follows entity/NFKC/trim normalization of the source ID.
 // Literal equality cannot preserve every raw spelling, and no new supplier
 // normalization function is assumed. Broaden only this evidence clause;
 // actual admission and the bounded pager still decide visibility/progress.
 return value.length?['(1=1)']:[];
}
const union=(clauses:string[])=>clauses.includes('(1=1)')?'(1=1)':'('+clauses.join(' or ')+')';
function compileSelection(input:AjesSourceSelection,phase:'k'|'u'|undefined,mode:number):string {
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
  const local=[...modelSql(powerModels,true,mode),...idsSql([...power.ids,...bodyIds]),...modelSql(power.ownerModels,false,mode)];
  // NFKC/entity values can have numeric prefix zero or a prefix below the
  // requested lower bound. Keep them as candidates; only the local matcher
  // applies that lower bound and strict hp validity. A literal comma cannot
  // normalize into integer hp, but local/manual exceptions remain outside it.
  // Numeric comparison behavior: https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html
  // This does not assert a supplier database version or parser compatibility.
  const wireBounds=['pw>=0',...(power.to===undefined?[]:[`pw<=${power.to}`]),"pw!=''","pw!='0'","pw not like '%,%'"];
  clauses.push(phase==='k'?union([`(${wireBounds.join(' and ')})`,...local])
   // A numeric unknown predicate loses malformed positive numeric prefixes.
   // The broad source preserves them; actual classification selects U.
   :'(1=1)');
 }else if(phase!==undefined)throw Error('ajes_invalid_query');
 if(input.body){
  const body=input.body;
  if(!record(body)||!exactKeys(body,['models','ids','sourceBody','pickupCandidates'])||typeof body.pickupCandidates!=='boolean')throw Error('ajes_invalid_query');
  const bodyClauses=[...modelSql(body.models,true,mode),...idsSql(body.ids)];
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

/** Prefer the most selective representable LIKE form. The caller reserves the
 * same worst-case SQL header/tail for LIST and its empty COUNT confirmation,
 * so page number, aggregation and sort cannot change candidate membership. */
export function japanSourceSelectionSql(input:AjesSourceSelection,phase?:'k'|'u',maxEncodedBytes=6000):string {
 if(!Number.isSafeInteger(maxEncodedBytes)||maxEncodedBytes<0)throw Error('ajes_invalid_query');
 for(let mode=0;mode<=7;mode++){
  const sql=compileSelection(input,phase,mode);
  if(encodedLength(sql)-4<=maxEncodedBytes)return sql;
 }
 // Every descriptor branch was validated above. When even the broad forms
 // cannot fit, leave admission to the bounded local reader instead of losing
 // selected identities. Outer user filters and source safeguards stay intact.
 return '(1=1)';
}
