/** Supplier SQL is generated here only; callers cannot supply SQL or column names. */
export type AjesTable = 'stats' | 'main';
export class AjesInputError extends Error { constructor() { super('ajes_invalid_query'); } }
export type AjesQuery = {table?: AjesTable; id?: string; make?: string; model?: string; yearFrom?: number; yearTo?: number; mileageTo?: number; page?: number; pageSize?: number};
const keys = new Set(['table','id','make','model','yearFrom','yearTo','mileageTo','page','pageSize']);
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
  const make=name(q.make), model=name(q.model);
  const yearFrom=integer(q.yearFrom,2010,2010,2100), yearTo=integer(q.yearTo,2100,2010,2100);
  if (yearFrom>yearTo) throw new AjesInputError();
  const page=integer(q.page,1,1,10000), pageSize=integer(q.pageSize,24,1,48);
  const where=[`year>=${yearFrom}`,`year<=${yearTo}`,'auction_type!=1'];
  if (table==='stats') where.push("status='Sold'",'finish>0');
  if (make) where.push(`marka_name='${make}'`);
  if (model) where.push(`model_name='${model}'`);
  if (q.mileageTo!==undefined) where.push(`mileage<=${integer(q.mileageTo,0,0,2000000)}`);
  return {table,kind:'list' as const,sql:`select * from ${table} where ${where.join(' and ')} order by auction_date desc, id asc limit ${(page-1)*pageSize},${pageSize}`,page,pageSize};
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

export function ajesLot(row: Record<string, unknown>, table: AjesTable, detail: boolean) {
  const text=(key:string)=>typeof row[key]==='string'?String(row[key]).trim():'';
  const number=(key:string)=>/^\d+(?:\.\d+)?$/.test(String(row[key]??''))?Number(row[key]):null;
  const id=text('ID'), year=number('YEAR');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !text('MARKA_NAME') || !text('MODEL_NAME') || !year || year<2010 || !Number.isInteger(year) || year>new Date().getUTCFullYear()+1 || number('AUCTION_TYPE')===1) return null;
  const sold=table==='stats' && /^sold$/i.test(text('STATUS'));
  const finish=number('FINISH');
  if (table==='stats' && (!sold || !finish)) return null;
  const urls=[...new Set(text('IMAGES').split('#').map(u=>ajesImageUrl(u,'original')).filter((u):u is string=>Boolean(u)))];
  return {
    id,table,kind:table==='stats'?'auction_result':'auction',make:text('MARKA_NAME'),model:text('MODEL_NAME'),year,
    trim:text('GRADE'),chassisCode:text('KUZOV'),frameNumber:detail?text('SERIAL'):undefined,
    mileageKm:number('MILEAGE'),engineCc:number('ENG_V'),auction:text('AUCTION'),lot:text('LOT'),auctionDate:text('AUCTION_DATE'),grade:text('RATE'),
    status:text('STATUS'),currency:'JPY',finalPriceJpy:sold?finish:null,startPriceJpy:table==='main'?(number('START')||null):null,
    // PW/PRIV/FUEL need a documented interpretation; preserve evidence, not invented specs.
    sourcePower:text('PW'),sourceDrive:text('PRIV'),sourceTransmission:text('KPP'),sourceFuel:text('FUEL'),
    info:detail?text('INFO'):undefined,
    images:urls.map((url,i)=>({url:ajesImageUrl(url,'medium')!,thumbnailUrl:ajesImageUrl(url,'small')!,originalUrl:url,role:detail&&i===0?'auction_sheet':'vehicle'})),
  };
}
