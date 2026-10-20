import {vehicleColorAliases} from './vehicle-colors';
import {parseCatalogSort} from './catalog-sort';
import {ajesSourceDetails} from './ajes-source-details';
import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
import {parseEngineCc} from './engine-input';
import {heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from './heavy-vehicle-families';
/** Supplier SQL is generated here only; callers cannot supply SQL or column names. */
export type AjesTable = 'stats' | 'main' | 'korea' | 'china';
export class AjesInputError extends Error { constructor() { super('ajes_invalid_query'); } }
export type AjesQuery = {table?: AjesTable; aggregate?: 'count'|'models'|'makes'|'colors'; sort?: string; color?:string; fuel?:string; transmission?:string; drive?:string; auctionGrade?:string; id?: string; make?: string; model?: string; modelFamilies?:string; chassis?:string; frameNumber?:string; lotNumber?:string; sourcePriceTo?:number; powerFrom?:number; powerTo?:number; yearFrom?: number; yearTo?: number; mileageFrom?:number; mileageTo?: number; engineFrom?:number; engineTo?:number; page?: number; pageSize?: number};
const keys = new Set(['aggregate','sort','color','fuel','transmission','drive','auctionGrade','table','id','make','model','modelFamilies','chassis','frameNumber','lotNumber','sourcePriceTo','powerFrom','powerTo','yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','page','pageSize']);
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
export function ajesQuery(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!keys.has(k))) throw new AjesInputError();
  const q = input as AjesQuery;
  const table = q.table ?? 'stats';
  if (!['stats','main','korea','china'].includes(table)) throw new AjesInputError();
  if (q.id !== undefined) {
    if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(q.id) || Object.keys(q).some(k=>!['table','id'].includes(k))) throw new AjesInputError();
    return {table, kind:'detail' as const, sql:`select * from ${table} where id='${q.id}'`, id:q.id, page:1, pageSize:1};
  }
  const values=(value:unknown,separator:string)=>{if(value===undefined)return [];if(typeof value!=='string')throw new AjesInputError();const parts=value.split(separator).map(v=>name(v)!);if(parts.length>20||parts.some(v=>!v))throw new AjesInputError();return [...new Set(parts)];};
  const makes=values(q.make,','),models=values(q.model,'|'),families=values(q.modelFamilies,'|');
  const stock=table==='korea'||table==='china',minYear=stock?new Date().getUTCFullYear()-6:JAPAN_MIN_MODEL_YEAR;
  const requestedYearFrom=integer(q.yearFrom,1900,1900,2100), yearTo=integer(q.yearTo,2100,1900,2100);
  if (requestedYearFrom>yearTo) throw new AjesInputError();
  // A shared catalog range may begin before this market's admission floor.
  // Intersect it with policy; a disjoint range is a valid empty query.
  const yearFrom=Math.max(minYear,requestedYearFrom);
  const page=integer(q.page,1,1,1000000), pageSize=integer(q.pageSize,24,1,48);
  const empty=yearFrom>Math.min(yearTo,new Date().getUTCFullYear()+(stock?0:1));
  const where=[`year>=${yearFrom}`,`year<=${Math.min(yearTo,new Date().getUTCFullYear()+(stock?0:1))}`];
  if(!stock)where.push('auction_type!=1');
  if(stock)where.push('finish>0');
  if(q.sourcePriceTo!==undefined){if(table!=='china')throw new AjesInputError();where.push(`finish<=${integer(q.sourcePriceTo,0,1,Number.MAX_SAFE_INTEGER)}`);}
  if(table==='korea'){const month=new Date(Date.now()+7*3600000).getUTCMonth()+1;where.push(`(year>${new Date().getUTCFullYear()-6} or month=0 or month is null or month>=${month})`);}
  if (table==='stats') where.push("status='Sold'",'finish>0');
  where.push("marka_name!=''","model_name!=''");
  where.push(heavyVehicleSqlExclusion());
  for(const [column,parts] of [['marka_name',makes]] as const){if(parts.length===1)where.push(`${column}='${parts[0]}'`);else if(parts.length)where.push(`${column} in (${parts.map(v=>`'${v}'`).join(',')})`);}
  const modelClauses=[...models.map(v=>`model_name='${v}'`),...families.map(v=>`model_name like '${v} %'`)];
  if(modelClauses.length)where.push('('+modelClauses.join(' or ')+')');
  if(q.color){const colors=[...new Set(values(q.color,'|').flatMap(value=>vehicleColorAliases(value).map(alias=>name(alias)!)))];where.push(`color in (${colors.map(value=>`'${value}'`).join(',')})`);}
  const coded=(value:string|undefined,column:string,map:Record<string,string[]>)=>{if(!value)return;const selected=value.split('|');if(selected.length>20||selected.some(v=>!map[v]))throw new AjesInputError();const codes=[...new Set(selected.flatMap(v=>map[v]))];where.push(`${column} in (${codes.map(v=>`'${v}'`).join(',')})`);};
  coded(q.fuel,'time',{petrol:['P'],diesel:['D'],electric:['E'],electrified:['E','H','HE'],hybrid:['H','HE'],lpg:['L'],cng:['C']});
  coded(q.transmission,'kpp',{automatic:['AT'],manual:['MT'],cvt:['CVT'],dct:['DCT']});
  coded(q.drive,'priv',{fwd:['FF','FWD'],rwd:['FR','RWD'],awd:['4WD','AWD','FULLTIME4WD']});
  if(q.auctionGrade){const grades=values(q.auctionGrade,'|');if(grades.some(v=>! /^(?:[0-6](?:\.5)?|S|R|RA|A|B|C)$/.test(v)))throw new AjesInputError();where.push(`rate in (${grades.map(v=>`'${v}'`).join(',')})`);}

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
    // Use the supplier's plain numeric comparison grammar. Validate normalized power again before display.
    where.push(`pw>=${low}`,`pw<=${high}`);
  }
  if(q.aggregate!==undefined&&!['count','models','makes','colors'].includes(q.aggregate))throw new AjesInputError();
  if(q.aggregate==='count')return {table,empty,kind:'count' as const,sql:`select count(*) from ${table} where ${where.join(' and ')}`,page:1,pageSize:1};
  if(q.aggregate==='colors')return {table,empty,kind:'colors' as const,sql:`select color, count(*) from ${table} where ${where.join(' and ')} group by color order by color limit ${(page-1)*500},500`,page,pageSize:500};
  if(q.aggregate==='makes')return {table,empty,kind:'makes' as const,sql:`select marka_name, count(*) from ${table} where ${where.join(' and ')} group by marka_name order by marka_name limit ${(page-1)*500},500`,page,pageSize:500};
  if(q.aggregate==='models')return {table,empty,kind:'models' as const,sql:`select marka_name, model_name, count(*) from ${table} where ${where.join(' and ')} group by marka_name, model_name order by marka_name, model_name limit ${(page-1)*500},500`,page,pageSize:500};
  const sort=q.sort??'updatedAt';
  const terms=parseCatalogSort(sort);if(!terms)throw new AjesInputError();
  const fields={mileage:'mileage asc',mileageDesc:'mileage desc',year:'year desc',yearAsc:'year asc',totalRub:'finish asc',totalRubDesc:'finish desc'};
  const order=terms.length?terms.map(term=>fields[term]).join(', ')+(stock||terms[0].startsWith('mileage')?'':', auction_date desc'):stock?'id desc':'auction_date desc';
  return {table,empty,kind:'list' as const,sql:`select * from ${table} where ${where.join(' and ')} order by ${order}, id asc limit ${(page-1)*pageSize},${pageSize}`,page,pageSize};
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
  const text=(key:string)=>ajesText(row[key]);
  const number=(key:string)=>/^\d+(?:\.\d+)?$/.test(text(key))?Number(text(key)):null;
  const id=text('ID'), year=number('YEAR'),stock=table==='korea'||table==='china';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !text('MARKA_NAME') || !text('MODEL_NAME') || !year || year<(stock?new Date().getUTCFullYear()-6:JAPAN_MIN_MODEL_YEAR) || !Number.isInteger(year) || year>new Date().getUTCFullYear()+1 || (!stock&&number('AUCTION_TYPE')===1)) return null;
  const sold=table==='stats' && /^sold$/i.test(text('STATUS'));
  if(knownHeavyVehicleFamily(text('MARKA_NAME'),text('MODEL_NAME')))return null;
  if(stock&&/^(?:sold|removed|withdrawn|deleted)$/i.test(text('STATUS')))return null;
  const finish=number('FINISH');
  if ((table==='stats' && !sold) || ((table==='stats'||stock)&&!finish)) return null;
  const urls=[...new Set(text('IMAGES').split('#').map(u=>ajesImageUrl(u,'original')).filter((u):u is string=>Boolean(u)))];
  return {
    id,table,kind:table==='stats'?'auction_result':'auction',make:text('MARKA_NAME'),model:text('MODEL_NAME'),year,
    trim:text('GRADE'),color:text('COLOR'),equipment:text('EQUIP'),transmissionCode:text('KPP_TYPE'),auctionTown:text('TOWN'),chassisCode:text('KUZOV'),frameNumber:detail?text('SERIAL'):undefined,
    mileageKm:number('MILEAGE'),engineCc:number('ENG_V'),auction:text('AUCTION'),lot:text('LOT'),auctionDate:text('AUCTION_DATE'),grade:text('RATE'),
    status:text('STATUS'),currency:table==='korea'?'KRW':table==='china'?'CNY':'JPY',sourcePrice:stock?finish:null,productionMonth:number('MONTH'),finalPriceJpy:sold?finish:null,startPriceJpy:table==='main'?(number('START')||null):null,
    // Supplier confirmed 2026-10-16: TIME is the fuel field; FUEL is a legacy alias.
    // Ambiguous PW/PRIV remain source evidence, not invented specifications.
    sourcePower:text('PW'),sourceDrive:text('PRIV'),sourceTransmission:text('KPP'),sourceFuel:text('TIME')||text('FUEL'),sourceFuelField:text('TIME')?'TIME':text('FUEL')?'FUEL':undefined,
    info:detail?text('INFO'):undefined,
    sourceDate:stock?text('MONTH'):undefined,
    sourceDetails:stock?ajesSourceDetails(text('INFO')):undefined,
    images:urls.map((url,i)=>({url:ajesImageUrl(url,'medium')!,thumbnailUrl:ajesImageUrl(url,'small')!,originalUrl:url,role:!stock&&detail&&i===0?'auction_sheet':'vehicle'})),
  };
}

export class AjesFilterUnavailable extends Error {constructor(){super('ajes_filter_unavailable');}}
const first=(v:unknown)=>Array.isArray(v)?String(v[0]??''):v==null?'':String(v);
export function ajesCatalogQuery(params:Record<string,unknown>):AjesQuery {
 if((params.market==='korea'||params.market==='china')&&first(params.frameNumber))throw new AjesFilterUnavailable();
 const q:AjesQuery={table:params.market==='korea'?'korea':params.market==='china'?'china':'stats',page:1,pageSize:24};
 for(const k of ['make','model','color','fuel','transmission','drive','auctionGrade','chassis','frameNumber','lotNumber'] as const){const v=first(params[k]);if(v)q[k]=v;}
 if(!q.make&&first(params.brand))q.make=first(params.brand);
 for(const k of ['yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','powerFrom','powerTo','page','pageSize'] as const){const v=first(params[k]);if(v){const n=k.startsWith('engine')?parseEngineCc(v):Number(v);if(n==null||!Number.isFinite(n))throw new AjesInputError();q[k]=n;}}
 const sort=first(params.sort);if(sort)q.sort=sort as AjesQuery['sort'];
 return q;
}
