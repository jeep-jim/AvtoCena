import {parseEngineCc} from './engine-input';
import {heavyVehicleSqlExclusion,knownHeavyVehicleFamily} from './heavy-vehicle-families';
/** Supplier SQL is generated here only; callers cannot supply SQL or column names. */
export type AjesTable = 'stats' | 'main';
export class AjesInputError extends Error { constructor() { super('ajes_invalid_query'); } }
export type AjesQuery = {table?: AjesTable; aggregate?: 'count'|'models'; sort?: 'updatedAt'|'year'|'yearAsc'|'totalRub'|'totalRubDesc'; fuel?:string; transmission?:string; drive?:string; auctionGrade?:string; id?: string; make?: string; model?: string; chassis?:string; lotNumber?:string; yearFrom?: number; yearTo?: number; mileageFrom?:number; mileageTo?: number; engineFrom?:number; engineTo?:number; page?: number; pageSize?: number};
const keys = new Set(['aggregate','sort','fuel','transmission','drive','auctionGrade','table','id','make','model','chassis','lotNumber','yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','page','pageSize']);
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
  if (!['stats','main'].includes(table)) throw new AjesInputError();
  if (q.id !== undefined) {
    if (typeof q.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(q.id) || Object.keys(q).some(k=>!['table','id'].includes(k))) throw new AjesInputError();
    return {table, kind:'detail' as const, sql:`select * from ${table} where id='${q.id}'`, id:q.id, page:1, pageSize:1};
  }
  const values=(value:unknown,separator:string)=>{if(value===undefined)return [];if(typeof value!=='string')throw new AjesInputError();const parts=value.split(separator).map(v=>name(v)!);if(parts.length>20||parts.some(v=>!v))throw new AjesInputError();return [...new Set(parts)];};
  const makes=values(q.make,','),models=values(q.model,'|');
  const yearFrom=integer(q.yearFrom,2010,2010,2100), yearTo=integer(q.yearTo,2100,2010,2100);
  if (yearFrom>yearTo) throw new AjesInputError();
  const page=integer(q.page,1,1,1000000), pageSize=integer(q.pageSize,24,1,48);
  const where=[`year>=${yearFrom}`,`year<=${Math.min(yearTo,new Date().getUTCFullYear()+1)}`,'auction_type!=1'];
  if (table==='stats') where.push("status='Sold'",'finish>0');
  where.push("marka_name!=''","model_name!=''");
  where.push(heavyVehicleSqlExclusion());
  for(const [column,parts] of [['marka_name',makes],['model_name',models]] as const){if(parts.length===1)where.push(`${column}='${parts[0]}'`);else if(parts.length)where.push(`${column} in (${parts.map(v=>`'${v}'`).join(',')})`);}
  const coded=(value:string|undefined,column:string,map:Record<string,string[]>)=>{if(!value)return;const codes=map[value];if(!codes)throw new AjesInputError();where.push(`${column} in (${codes.map(v=>`'${v}'`).join(',')})`);};
  coded(q.fuel,'time',{petrol:['P'],diesel:['D'],electric:['E'],electrified:['E','H','HE'],hybrid:['H','HE'],lpg:['L'],cng:['C']});
  coded(q.transmission,'kpp',{automatic:['AT'],manual:['MT'],cvt:['CVT'],dct:['DCT']});
  coded(q.drive,'priv',{fwd:['FF','FWD'],rwd:['FR','RWD'],awd:['4WD','AWD','FULLTIME4WD']});
  if(q.auctionGrade){const grades=values(q.auctionGrade,'|');if(grades.some(v=>! /^(?:[0-6](?:\.5)?|S|R|RA|A|B|C)$/.test(v)))throw new AjesInputError();where.push(`rate in (${grades.map(v=>`'${v}'`).join(',')})`);}

  if(q.chassis!==undefined)where.push(`kuzov='${name(q.chassis)}'`);
  if(q.lotNumber!==undefined){if(typeof q.lotNumber!=='string'||!/^\d{1,10}$/.test(q.lotNumber))throw new AjesInputError();where.push(`lot='${q.lotNumber}'`);}
  for(const [from,to,column,max] of [['mileageFrom','mileageTo','mileage',2000000],['engineFrom','engineTo','eng_v',20000]] as const){
    const low=integer(q[from],0,0,max),high=integer(q[to],max,0,max);
    if(low>high)throw new AjesInputError();
    if(q[from]!==undefined)where.push(`${column}>=${low}`);
    if(q[to]!==undefined)where.push(`${column}<=${high}`);
  }
  if(q.aggregate!==undefined&&!['count','models'].includes(q.aggregate))throw new AjesInputError();
  if(q.aggregate==='count')return {table,kind:'count' as const,sql:`select count(*) from ${table} where ${where.join(' and ')}`,page:1,pageSize:1};
  if(q.aggregate==='models')return {table,kind:'models' as const,sql:`select marka_name, model_name, count(*) from ${table} where ${where.join(' and ')} group by marka_name, model_name order by marka_name, model_name limit ${(page-1)*500},500`,page,pageSize:500};
  const sort=q.sort??'updatedAt';
  if(!['updatedAt','year','yearAsc','totalRub','totalRubDesc'].includes(sort))throw new AjesInputError();
  const order=sort==='totalRub'?'finish asc, auction_date desc':sort==='totalRubDesc'?'finish desc, auction_date desc':sort==='yearAsc'?'year asc, auction_date desc':sort==='year'?'year desc, auction_date desc':'auction_date desc';
  return {table,kind:'list' as const,sql:`select * from ${table} where ${where.join(' and ')} order by ${order}, id asc limit ${(page-1)*pageSize},${pageSize}`,page,pageSize};
}

/** Provider uses &w=320 even when no question mark is present. Never download images here. */
export function ajesImageUrl(value: unknown, size: 'small'|'medium'|'original'='medium') {
  if (typeof value!=='string') return null;
  try {
    const u=new URL(value);
    if (u.protocol!=='https:' || u.username || u.password || u.port || !/^(?:7\.tru\.ru|7\.ajes\.com|8\.ajes\.com)$/.test(u.hostname) || !/^\/imgs?\/[A-Za-z0-9_-]+(?:&(?:h|w)=\d+)*$/.test(u.pathname) || u.search || u.hash) return null;
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
  const id=text('ID'), year=number('YEAR');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !text('MARKA_NAME') || !text('MODEL_NAME') || !year || year<2010 || !Number.isInteger(year) || year>new Date().getUTCFullYear()+1 || number('AUCTION_TYPE')===1) return null;
  const sold=table==='stats' && /^sold$/i.test(text('STATUS'));
  if(knownHeavyVehicleFamily(text('MARKA_NAME'),text('MODEL_NAME')))return null;
  const finish=number('FINISH');
  if (table==='stats' && (!sold || !finish)) return null;
  const urls=[...new Set(text('IMAGES').split('#').map(u=>ajesImageUrl(u,'original')).filter((u):u is string=>Boolean(u)))];
  return {
    id,table,kind:table==='stats'?'auction_result':'auction',make:text('MARKA_NAME'),model:text('MODEL_NAME'),year,
    trim:text('GRADE'),color:text('COLOR'),equipment:text('EQUIP'),transmissionCode:text('KPP_TYPE'),auctionTown:text('TOWN'),chassisCode:text('KUZOV'),frameNumber:detail?text('SERIAL'):undefined,
    mileageKm:number('MILEAGE'),engineCc:number('ENG_V'),auction:text('AUCTION'),lot:text('LOT'),auctionDate:text('AUCTION_DATE'),grade:text('RATE'),
    status:text('STATUS'),currency:'JPY',finalPriceJpy:sold?finish:null,startPriceJpy:table==='main'?(number('START')||null):null,
    // Supplier confirmed 2026-10-16: TIME is the fuel field; FUEL is a legacy alias.
    // Ambiguous PW/PRIV remain source evidence, not invented specifications.
    sourcePower:text('PW'),sourceDrive:text('PRIV'),sourceTransmission:text('KPP'),sourceFuel:text('TIME')||text('FUEL'),sourceFuelField:text('TIME')?'TIME':text('FUEL')?'FUEL':undefined,
    info:detail?text('INFO'):undefined,
    images:urls.map((url,i)=>({url:ajesImageUrl(url,'medium')!,thumbnailUrl:ajesImageUrl(url,'small')!,originalUrl:url,role:detail&&i===0?'auction_sheet':'vehicle'})),
  };
}

export class AjesFilterUnavailable extends Error {constructor(){super('ajes_filter_unavailable');}}
const first=(v:unknown)=>Array.isArray(v)?String(v[0]??''):v==null?'':String(v);
export function ajesCatalogQuery(params:Record<string,unknown>):AjesQuery {
 if(['budget','budgetFrom','budgetTo','powerFrom','powerTo','bodyType','hasPrice'].some(k=>Boolean(first(params[k]))))throw new AjesFilterUnavailable();
 const q:AjesQuery={table:'stats',page:1,pageSize:24};
 for(const k of ['make','model','fuel','transmission','drive','auctionGrade','chassis','lotNumber'] as const){const v=first(params[k]);if(v)q[k]=v;}
 if(!q.make&&first(params.brand))q.make=first(params.brand);
 for(const k of ['yearFrom','yearTo','mileageFrom','mileageTo','engineFrom','engineTo','page'] as const){const v=first(params[k]);if(v){const n=k.startsWith('engine')?parseEngineCc(v):Number(v);if(n==null||!Number.isFinite(n))throw new AjesInputError();q[k]=n;}}
 const sort=first(params.sort);if(sort)q.sort=sort as AjesQuery['sort'];
 return q;
}
