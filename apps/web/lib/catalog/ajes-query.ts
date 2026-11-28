import type {CalculationIndex} from '../encyclopedia/calculation-index';
import {pickupSourceCandidateSql} from './pickup-body';
import {japanSourceSelectionSql} from './japan-source-selection-sql';
import type {AjesSourceSelection} from './japan-source-selection';
import {japanDriveSql} from './japan-drive';
import {auctionSaleRange} from "./auction-sale-period";
import {japanMakeSqlExclusion,japanVehicleTypeExcluded,japanVehicleFamilySqlExclusion,japanVehicleFamilyCacheSqlExclusion,japanHeavyVehicleSqlExclusion} from './japan-vehicle-policy';
import {assertAjesJapanMarket} from './ajes-access-policy';
import {motorcycleExcluded,motorcycleSqlExclusion} from './motorcycle-policy';
import {vehicleColorAliases} from './vehicle-colors';
import {parseCatalogSort} from './catalog-sort';
import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
import {parseEngineCc} from './engine-input';
import {auctionGradeLabel} from './japan-export-restriction';
import {heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from './heavy-vehicle-families';
/** Supplier SQL is generated here only; callers cannot supply SQL or column names. */
export type AjesTable = 'stats' | 'main';
export class AjesInputError extends Error { constructor() { super('ajes_invalid_query'); } }
/** A prior power-order cursor cannot be safely continued under new evidence. */
export class AjesCursorRefreshRequired extends AjesInputError {}
/** Server-resolved source names, never accepted by ajesCatalogQuery from a URL.
 * A twenty-choice UI guard must not truncate a larger observed source family.
 * Names retain the same SQL validation; transport-size failures remain explicit.
 */
export type AjesResolvedModels = {exact:string[];families:string[]};
/** Observed source aliases of a bounded user make selection; URL parsing
 * never accepts this descriptor and every name retains normal SQL validation. */
export type AjesResolvedMakes = {exact:string[]};
/** Counter dimensions only. Identity, images, auction dates and lot numbers
 * never enter a census projection. Optional columns need an observed schema. */
export const AJES_CENSUS_FIELDS = ['MARKA_NAME','MODEL_NAME','YEAR','GRADE','KUZOV','ENG_V','PRIV','KPP','TIME','PW','STATUS','COLOR','BODY_TYPE','VEHICLE_CATEGORY','FUEL'] as const;
export type AjesCensusField = typeof AJES_CENSUS_FIELDS[number];
export const AJES_CENSUS_REQUIRED_FIELDS = AJES_CENSUS_FIELDS.slice(0,12);
export type AjesQuery = {sourceSelection?:AjesSourceSelection;sourcePhase?:'k'|'u';pickup?:boolean;salePeriod?:string; table?: AjesTable; aggregate?: 'count'|'models'|'makes'|'colors'|'census'; countIdentity?:boolean; censusFields?:AjesCensusField[]; correctionId?:string; sort?: string; color?:string; fuel?:string; transmission?:string; drive?:string; auctionGrade?:string; id?: string; make?: string; resolvedMakes?:AjesResolvedMakes; model?: string; modelFamilies?:string; resolvedModels?:AjesResolvedModels; chassis?:string; frameNumber?:string; lotNumber?:string; sourcePriceTo?:number; powerFrom?:number; powerTo?:number; yearFrom?: number; yearTo?: number; mileageFrom?:number; mileageTo?: number; engineFrom?:number; engineTo?:number; page?: number; pageSize?: number};
const keys = new Set(['sourceSelection','sourcePhase','pickup','salePeriod','aggregate','countIdentity','censusFields','correctionId','sort','color','fuel','transmission','drive','auctionGrade','table','id','make','resolvedMakes','model','modelFamilies','resolvedModels','chassis','frameNumber','lotNumber','sourcePriceTo','powerFrom','powerTo','yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','page','pageSize']);
/** These fixed predicates select the same raw rows. Sharing their cache identity
 * lets local power changes reuse an already requested page without another AJ read.
 * Keep the actual compact SQL on the wire for the existing URI-size boundary.
 */
export function ajesSourceCacheSql(sql:string):string {
 return sql.replace(japanHeavyVehicleSqlExclusion(),heavyVehicleSqlExclusion())
  .replace(heavyVehicleSqlExclusion(false,false,true),heavyVehicleSqlExclusion())
  .replace(japanVehicleFamilySqlExclusion(),japanVehicleFamilyCacheSqlExclusion());
}
function integer(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new AjesInputError();
  return value;
}
function name(value: unknown) {
  if (value === undefined) return undefined;
  // Deliberately reject quotes, escapes and SQL punctuation instead of escaping user SQL.
  if (typeof value !== 'string' || !/^[\p{L}\p{N} .+()&/-]{1,80}$/u.test(value.trim())) throw new AjesInputError();
  return value.trim().toUpperCase();
}
export function ajesQuery(input: unknown,driveIndex:CalculationIndex|null=null) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!keys.has(k))) throw new AjesInputError();
  const q = input as AjesQuery;
  const table = q.table ?? 'stats';
  if (!['stats','main'].includes(table)) throw new AjesInputError();
  if (q.id !== undefined) {
    if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(q.id) || Object.keys(q).some(k=>!['table','id'].includes(k))) throw new AjesInputError();
    return {table, kind:'detail' as const, sql:`select * from ${table} where id='${q.id}'`, id:q.id, page:1, pageSize:1};
  }
  const values=(value:unknown,separator:string)=>{if(value===undefined)return [];if(typeof value!=='string')throw new AjesInputError();const parts=value.split(separator).map(v=>name(v)!);if(parts.length>20||parts.some(v=>!v))throw new AjesInputError();return [...new Set(parts)];};
  let makes=values(q.make,','),models=values(q.model,'|'),families=values(q.modelFamilies,'|');
  if(q.resolvedMakes!==undefined){
    const resolved=q.resolvedMakes;
    if(!resolved||typeof resolved!=='object'||Array.isArray(resolved)||Object.keys(resolved).some(key=>key!=='exact')
      ||!Array.isArray(resolved.exact)||!resolved.exact.length)throw new AjesInputError();
    makes=[...new Set(resolved.exact.map(value=>name(value)!))];
    if(makes.some(value=>!value))throw new AjesInputError();
  }
  if(q.resolvedModels!==undefined){
    const resolved=q.resolvedModels;
    if(!resolved||typeof resolved!=='object'||Array.isArray(resolved)||Object.keys(resolved).some(key=>key!=='exact'&&key!=='families')
      ||!Array.isArray(resolved.exact)||!Array.isArray(resolved.families)||!resolved.exact.length&&!resolved.families.length
      ||q.model!==undefined||q.modelFamilies!==undefined)throw new AjesInputError();
    models=[...new Set(resolved.exact.map(value=>name(value)!))];families=[...new Set(resolved.families.map(value=>name(value)!))];
    if([...models,...families].some(value=>!value))throw new AjesInputError();
  }
  const requestedYearFrom=integer(q.yearFrom,1900,1900,2100), yearTo=integer(q.yearTo,2100,1900,2100);
  if (requestedYearFrom>yearTo) throw new AjesInputError();
  // A shared catalog range may begin before this market's admission floor.
  // Intersect it with policy; a disjoint range is a valid empty query.
  const yearFrom=Math.max(JAPAN_MIN_MODEL_YEAR,requestedYearFrom);
  const page=integer(q.page,1,1,1000000), pageSize=integer(q.pageSize,24,1,48);
  const empty=yearFrom>Math.min(yearTo,new Date().getUTCFullYear()+1);
  const where=[`year>=${yearFrom}`,`year<=${Math.min(yearTo,new Date().getUTCFullYear()+1)}`];
  if(q.correctionId!==undefined){
    if(q.aggregate!=='census'||typeof q.correctionId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(q.correctionId))throw new AjesInputError();
    where.push(`id='${q.correctionId}'`);
  }
  where.push('auction_type!=1');
  if(q.sourcePriceTo!==undefined)throw new AjesInputError();
  if(q.salePeriod){
    if(table!=='stats'||typeof q.salePeriod!=='string')throw new AjesInputError();
    let range;try{range=auctionSaleRange(q.salePeriod);}catch{throw new AjesInputError();}
    if(range)where.push(`auction_date>='${range.from}'`,`auction_date<'${range.toExclusive}'`);
  }
  if (table==='stats') where.push("status='Sold'",'finish>0');
  where.push("marka_name!=''","model_name!=''");
  // Restore the older =/LIKE grammar for plain/model/filter directories while
  // grouping identical families to stay below the existing URI budget. This
  // does not establish a supplier-wide REGEXP restriction. Drive and the new
  // internal candidate selections retain the equivalent compact form; their
  // own predicates already use REGEXP and need room within the URI budget.
  where.push(q.drive||q.sourceSelection?heavyVehicleSqlExclusion(false,false,true):japanHeavyVehicleSqlExclusion(),motorcycleSqlExclusion());
  where.push(japanMakeSqlExclusion(),japanVehicleFamilySqlExclusion());
  for(const [column,parts] of [['marka_name',makes]] as const){if(parts.length===1)where.push(`${column}='${parts[0]}'`);else if(parts.length)where.push(`${column} in (${parts.map(v=>`'${v}'`).join(',')})`);}
  const exactModels=models.length>1?`model_name in (${models.map(v=>`'${v}'`).join(',')})`:models.length?`model_name='${models[0]}'`:null;
  const modelClauses=[...(exactModels?[exactModels]:[]),...families.map(v=>`model_name like '${v} %'`)];
  if(modelClauses.length)where.push('('+modelClauses.join(' or ')+')');
  if(q.color){const colors=[...new Set(values(q.color,'|').flatMap(value=>vehicleColorAliases(value).map(alias=>name(alias)!)))];where.push(`color in (${colors.map(value=>`'${value}'`).join(',')})`);}
  const coded=(value:string|undefined,column:string,map:Record<string,string[]>)=>{if(!value)return;const selected=value.split('|');if(selected.length>20||selected.some(v=>!map[v]))throw new AjesInputError();const codes=[...new Set(selected.flatMap(v=>map[v]))];where.push(`${column} in (${codes.map(v=>`'${v}'`).join(',')})`);};
  coded(q.fuel,'time',{petrol:['P'],diesel:['D'],electric:['E'],electrified:['E','H','HE'],hybrid:['H','HE'],lpg:['L'],cng:['C']});
  if(q.fuel?.split('|').includes('petrol')){const fuelClause=where.pop()!;where.push(`(${fuelClause} or time is null or time='')`);}
  coded(q.transmission,'kpp',{automatic:['AT'],manual:['MT'],cvt:['CVT'],dct:['DCT']});
  if(q.drive)where.push(japanDriveSql(q.drive,driveIndex));
  if(q.pickup!==undefined){if(q.pickup!==true)throw new AjesInputError();where.push(pickupSourceCandidateSql(false));}
  if(q.auctionGrade){
    if(typeof q.auctionGrade!=='string')throw new AjesInputError();
    const selected=q.auctionGrade.split('|'),grades=selected.map(auctionGradeLabel);
    // Use the same finite source-grade alphabet as the picker, including stars
    // and legacy decimal commas, without relaxing make/model SQL validation.
    if(selected.length>20||grades.some(grade=>!grade))throw new AjesInputError();
    where.push(`rate in (${[...new Set(grades)].map(grade=>`'${grade}'`).join(',')})`);
  }

  if(q.chassis!==undefined)where.push(`kuzov='${name(q.chassis)}'`);
  if(q.frameNumber!==undefined)where.push(`serial='${name(q.frameNumber)}'`);
  if(q.lotNumber!==undefined){if(typeof q.lotNumber!=='string'||!/^\d{1,10}$/.test(q.lotNumber.trim()))throw new AjesInputError();where.push(`lot='${q.lotNumber.trim()}'`);}
  for(const [from,to,column,max] of [['mileageFrom','mileageTo','mileage',2000000],['engineFrom','engineTo','eng_v',20000]] as const){
    const low=integer(q[from],0,0,max),high=integer(q[to],max,0,max);
    if(low>high)throw new AjesInputError();
    if(q[from]!==undefined)where.push(`${column}>=${low}`);
    if(q[to]!==undefined)where.push(`${column}<=${high}`);
  }
  if(q.powerFrom!==undefined||q.powerTo!==undefined){
    const low=integer(q.powerFrom,1,1,2500),high=integer(q.powerTo,2500,1,2500);
    if(low>high)throw new AjesInputError();
    // Raw queries and independent counts retain their established cache scope.
    // The internal descriptor below includes every resolved local/manual power
    // candidate as well as supplier PW; final enrichment remains authoritative.
  }
  // Only an internal, validated descriptor can narrow K/U or body candidates.
  // Public URL parsing never accepts it. COUNT confirmation inherits the exact
  // phase predicate; ordinary catalogue totals and directories stay independent.
  if(q.sourceSelection!==undefined){
    if(table!=='stats'||q.aggregate!==undefined&&q.aggregate!=='count')throw new AjesInputError();
    try{where.push(japanSourceSelectionSql(q.sourceSelection,q.sourcePhase));}
    catch{throw new AjesInputError();}
  }else if(q.sourcePhase!==undefined)throw new AjesInputError();
  if(q.aggregate!==undefined&&!['count','models','makes','colors','census'].includes(q.aggregate))throw new AjesInputError();
  if(q.censusFields!==undefined&&q.aggregate!=='census')throw new AjesInputError();
  if(q.countIdentity!==undefined&&(q.countIdentity!==true||q.aggregate!=='count'))throw new AjesInputError();
  if(q.aggregate==='census'){
    if(table!=='stats'||!Array.isArray(q.censusFields)||!q.censusFields.length||q.censusFields.some(field=>!AJES_CENSUS_FIELDS.includes(field))
      ||new Set(q.censusFields).size!==q.censusFields.length||AJES_CENSUS_REQUIRED_FIELDS.some(field=>!q.censusFields!.includes(field)))throw new AjesInputError();
    const censusFields=AJES_CENSUS_FIELDS.filter(field=>q.censusFields!.includes(field));
    // Binary grouping preserves distinctions which the JS normalizer may treat
    // differently. The validity aggregate proves that representative IDs do
    // not conceal rejected or noncanonical supplier identities.
    const columns=censusFields.map(field=>field.toLowerCase());
    const grouping=censusFields.map((_,index)=>index+1).join(',');
    const projection=columns.map(field=>`binary ${field} as ${field}`).join(', ');
    return {table,empty,kind:'census' as const,censusFields,sql:`select ${projection}, count(*) as census_count, sum(case when id regexp '^[A-Za-z0-9_-]{1,64}$' then 1 else 0 end) as census_valid_ids, sum(case when finish regexp '^[0-9]+([.][0-9]+)?$' and finish>0 and finish<=9007199254740991 then 1 else 0 end) as census_valid_finishes from ${table} where ${where.join(' and ')} group by ${grouping} order by ${grouping} limit ${(page-1)*500},500`,page,pageSize:500};
  }
  if(q.aggregate==='count'&&q.countIdentity)return {table,empty,kind:'count' as const,identityCount:true,sql:`select count(*) as total, count(distinct binary id) as census_distinct_ids from ${table} where ${where.join(' and ')}`,page:1,pageSize:1};
  if(q.aggregate==='count')return {table,empty,kind:'count' as const,sql:`select count(*) from ${table} where ${where.join(' and ')}`,page:1,pageSize:1};
  if(q.aggregate==='colors')return {table,empty,kind:'colors' as const,sql:`select color, count(*) from ${table} where ${where.join(' and ')} group by color order by color limit ${(page-1)*500},500`,page,pageSize:500};
  if(q.aggregate==='makes')return {table,empty,kind:'makes' as const,sql:`select marka_name, count(*) from ${table} where ${where.join(' and ')} group by marka_name order by marka_name limit ${(page-1)*500},500`,page,pageSize:500};
  if(q.aggregate==='models')return {table,empty,kind:'models' as const,sql:`select marka_name, model_name, count(*) from ${table} where ${where.join(' and ')} group by marka_name, model_name order by marka_name, model_name limit ${(page-1)*500},500`,page,pageSize:500};
  const sort=q.sort??'updatedAt';
  const terms=parseCatalogSort(sort);if(!terms)throw new AjesInputError();
  const fields={auctionDateAsc:'auction_date asc',auctionDateDesc:'auction_date desc',mileage:'mileage asc',mileageDesc:'mileage desc',year:'year desc',yearAsc:'year asc',totalRub:'finish asc',totalRubDesc:'finish desc'};
  const order=terms.length?terms.map(term=>fields[term]).join(', ')+(terms.some(t=>t.startsWith('auctionDate'))||terms[0].startsWith('mileage')?'':', auction_date desc'):'auction_date desc';
  return {table,empty,kind:'list' as const,sql:`select * from ${table} where ${where.join(' and ')} order by ${order}, id asc limit ${(page-1)*pageSize},${pageSize}`,page,pageSize,...(q.powerFrom!==undefined?{powerFrom:q.powerFrom}:{}),...(q.powerTo!==undefined?{powerTo:q.powerTo}:{})};
}

/** Provider uses &w=320 even when no question mark is present. Never download images here. */
export function ajesImageUrl(value: unknown, size: 'small'|'medium'|'original'='medium') {
  if (typeof value!=='string') return null;
  try {
    const u=new URL(value);
    if (u.protocol!=='https:' || u.username || u.password || u.port || !/^(?:7\.tru\.ru|7\.ajes\.com|8\.ajes\.com|9\.ajes\.com)$/.test(u.hostname) || !/^\/imgs?\/[A-Za-z0-9_-]+(?:&(?:h|w)=\d+)*$/.test(u.pathname) || u.search || u.hash) return null;
    const base=value.replace(/&(?:h|w)=\d+/g,'');
    return base+(size==='small'?'&h=50':size==='medium'?'&w=320':'');
  } catch {return null;}
}

/** Decode supplier text as text only, including old saved responses. Never render HTML. */
export function ajesText(value: unknown): string {
  if(typeof value!=='string'&&typeof value!=='number')return '';
  const named:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(original,key:string)=>{
    if(key[0]!=='#')return named[key.toLowerCase()]??original;
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):original;
  }).normalize('NFKC').trim();
}
export function ajesLot(row: Record<string, unknown>, table: AjesTable, detail: boolean) {
  if(table!=='stats'&&table!=='main')return null;
  const text=(key:string)=>ajesText(row[key]);
  const number=(key:string)=>/^\d+(?:\.\d+)?$/.test(text(key))?Number(text(key)):null;
  const id=text('ID'), year=number('YEAR');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !text('MARKA_NAME') || !text('MODEL_NAME') || !year || year<JAPAN_MIN_MODEL_YEAR || !Number.isInteger(year) || year>new Date().getUTCFullYear()+1 || number('AUCTION_TYPE')===1) return null;
  const sold=table==='stats' && /^sold$/i.test(text('STATUS'));
  const vehicle={market:'japan',make:text('MARKA_NAME'),model:text('MODEL_NAME'),trim:text('GRADE'),bodyType:text('BODY_TYPE'),vehicleCategory:text('VEHICLE_CATEGORY')};
  if(japanVehicleTypeExcluded(vehicle)||knownHeavyVehicleFamily(vehicle.make,vehicle.model)||motorcycleExcluded(vehicle))return null;
  const finish=number('FINISH');
  if (table==='stats' && (!sold || !finish)) return null;
  const urls=[...new Set(text('IMAGES').split('#').map(u=>ajesImageUrl(u,'original')).filter((u):u is string=>Boolean(u)))];
  return {
    id,table,kind:table==='stats'?'auction_result':'auction',make:text('MARKA_NAME'),model:text('MODEL_NAME'),year,
    trim:text('GRADE'),color:text('COLOR'),equipment:text('EQUIP'),transmissionCode:text('KPP_TYPE'),auctionTown:text('TOWN'),chassisCode:text('KUZOV'),frameNumber:detail?text('SERIAL'):undefined,
    mileageKm:number('MILEAGE'),engineCc:number('ENG_V'),auction:text('AUCTION'),lot:text('LOT'),auctionDate:text('AUCTION_DATE'),grade:text('RATE'),
    status:text('STATUS'),currency:'JPY',sourcePrice:null,productionMonth:number('MONTH'),finalPriceJpy:sold?finish:null,startPriceJpy:table==='main'?(number('START')||null):null,
    // Supplier confirmed 2026-10-16: TIME is the fuel field; FUEL is a legacy alias.
    // PW is integer hp serialized in varchar(30), confirmed by AJ in November 2026.
    // Preserve the wire value; strict discovery parsing must not invent components.
    sourcePower:text('PW'),sourceBody:text('BODY_TYPE'),sourceDrive:text('PRIV'),sourceTransmission:text('KPP'),sourceFuel:text('TIME')||text('FUEL'),sourceFuelField:text('TIME')?'TIME':text('FUEL')?'FUEL':undefined,
    info:detail?text('INFO'):undefined,
    sourceDate:undefined,
    sourceDetails:undefined,
    images:urls.map((url,i)=>({url:ajesImageUrl(url,'medium')!,thumbnailUrl:ajesImageUrl(url,'small')!,originalUrl:url,role:detail&&i===0?'auction_sheet':'vehicle'})),
  };
}

export class AjesFilterUnavailable extends Error {constructor(){super('ajes_filter_unavailable');}}
const first=(v:unknown)=>Array.isArray(v)?String(v[0]??''):v==null?'':String(v);
export function ajesCatalogQuery(params:Record<string,unknown>):AjesQuery {
 assertAjesJapanMarket(params.market);
 const q:AjesQuery={table:'stats',page:1,pageSize:24};
 for(const k of ['make','model','color','fuel','transmission','drive','auctionGrade','chassis','frameNumber','lotNumber'] as const){const v=first(params[k]);if(v)q[k]=v;}
 if(q.table==='stats'&&first(params.salePeriod))q.salePeriod=first(params.salePeriod);
 if(!q.make&&first(params.brand))q.make=first(params.brand);
 for(const k of ['yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','powerFrom','powerTo','page','pageSize'] as const){const v=first(params[k]);if(v){const n=k.startsWith('engine')?parseEngineCc(v):Number(v);if(n==null||!Number.isFinite(n))throw new AjesInputError();q[k]=n;}}
 if(first(params.bodyType||params.body)==='pickup')q.pickup=true;
 const sort=first(params.sort);if(sort)q.sort=sort as AjesQuery['sort'];
 return q;
}
