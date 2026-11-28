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
function modelSql(rows:unknown,annual:boolean,mode=0,compact=false):string[] {
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
 const any=(clauses:string[])=>clauses.length===1?clauses[0]:'('+clauses.join(' or ')+')';
 const shortest=(variants:string[])=>variants.sort((a,b)=>encodedLength(a)-encodedLength(b)||a.localeCompare(b))[0];
 const namesSql=(models:string[])=>{
  const ordinary=any(models.map(model=>pattern('model_name',model)));
  if(compact){
   // Use the same literal substring candidates without repeating the column
   // and LIKE wrapper for every observed name. These bracket escapes use the
   // existing source REGEXP grammar and need no SQL backslash processing.
   // Keep '_' in LIKE: it already represents one source wildcard there.
   const literalNames=models.filter(model=>!model.includes('_'));
   const clauses=models.filter(model=>model.includes('_')).map(model=>pattern('model_name',model));
   if(literalNames.length){
    const expression=literalNames.map(model=>model.replace(/[.+()]/g,character=>`[${character}]`)).join('|');
    clauses.unshift(`model_name regexp '(${expression})'`);
   }
   return shortest([ordinary,any(clauses)]);
  }
  return ordinary;
 };
 if(compact&&mode<=1){
  // Factor the exact finite relation before weakening it. A shared make is
  // written once; either model->years or year->models can be shorter. Identical
  // model/year tails across makes can share one expression as well.
  const byMake=new Map<string,Map<string,Set<number>>>();
  for(const group of grouped.values()){
   const make=mode===0?group.make:'',models=byMake.get(make)||new Map<string,Set<number>>();
   for(const model of group.models){
    const years=models.get(model)||new Set<number>();
    group.years?.forEach(year=>years.add(year));models.set(model,years);
   }
   byMake.set(make,models);
  }
  const tails=new Map<string,string[]>();
  for(const [make,models] of byMake){
   let inner:string;
   if(!annual)inner=namesSql(orderedStrings([...models.keys()]));
   else{
    const byYears=new Map<string,{years:number[];models:string[]}>(),byYear=new Map<number,string[]>();
    for(const [model,years] of models){
     const ordered=[...years].sort((a,b)=>a-b),key=JSON.stringify(ordered);
     const group=byYears.get(key)||{years:ordered,models:[]};group.models.push(model);byYears.set(key,group);
     for(const year of years){const names=byYear.get(year)||[];names.push(model);byYear.set(year,names);}
    }
    const byModels=new Map<string,{years:number[];models:string[]}>();
    for(const [year,models] of byYear){
     const ordered=orderedStrings(models),key=JSON.stringify(ordered);
     const group=byModels.get(key)||{years:[],models:ordered};group.years.push(year);byModels.set(key,group);
    }
    inner=shortest([byYears,byModels].map(groups=>any([...groups.values()].map(group=>
     '('+namesSql(orderedStrings(group.models))+' and '+yearsSql(group.years.sort((a,b)=>a-b))+')').sort())));
   }
   const makes=tails.get(inner)||[];makes.push(make);tails.set(inner,makes);
  }
  return [...tails].map(([inner,makes])=>mode===0
   ?'('+any(orderedStrings(makes).map(make=>pattern('marka_name',make)))+' and '+inner+')':inner).sort();
 }
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
 // Canonical ASCII IDs are unchanged by that normalization, so exact IN is
 // complete for them. Changed spellings contain a character outside the ASCII
 // alphabet. ICU simple case-folding can treat Kelvin/long-s as K/s inside the
 // negated set, so retain these literal candidates when that target ID needs
 // them too. No BINARY string or supplier normalization function is assumed.
 // https://unicode-org.github.io/icu/userguide/strings/regexp.html#case-insensitive-matching
 // These are conservative candidates; final admission validates every row.
 const ids=orderedStrings(value);
 const caseAliases=[...(ids.some(id=>id.includes('K'))?["id like '%K%'"]:[]),
  ...(ids.some(id=>id.includes('s'))?["id like '%ſ%'"]:[])];
 return ids.length?[`(id in (${ids.map(id=>`'${id}'`).join(',')}) or id regexp '[^A-Za-z0-9_-]'${caseAliases.length?' or '+caseAliases.join(' or '):''})`]:[];
}
const union=(clauses:string[])=>clauses.includes('(1=1)')?'(1=1)':'('+clauses.join(' or ')+')';
function compileSelection(input:AjesSourceSelection,phase:'k'|'u'|undefined,mode:number,compact=false):string {
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
  const local=[...modelSql(powerModels,true,mode,compact),...idsSql([...power.ids,...bodyIds]),...modelSql(power.ownerModels,false,mode,compact)];
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
  const bodyClauses=[...modelSql(body.models,true,mode,compact),...idsSql(body.ids)];
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

/** Prefer the most selective representable form. Try compact, equivalent
 * literal alternation before dropping a make, year or part of an observed name.
 * Small existing LIKE queries keep their original wire/cache identity.
 * The caller reserves the
 * same worst-case SQL header/tail for LIST and its empty COUNT confirmation,
 * so page number, aggregation and sort cannot change candidate membership. */
export function japanSourceSelectionSql(input:AjesSourceSelection,phase?:'k'|'u',maxEncodedBytes=6000):string {
 if(!Number.isSafeInteger(maxEncodedBytes)||maxEncodedBytes<0)throw Error('ajes_invalid_query');
 for(let mode=0;mode<=7;mode++){
  const sql=compileSelection(input,phase,mode);
  if(encodedLength(sql)-4<=maxEncodedBytes)return sql;
  const compact=compileSelection(input,phase,mode,true);
  if(encodedLength(compact)-4<=maxEncodedBytes)return compact;
 }
 // Every descriptor branch was validated above. When even the broad forms
 // cannot fit, leave admission to the bounded local reader instead of losing
 // selected identities. Outer user filters and source safeguards stay intact.
 return '(1=1)';
}
