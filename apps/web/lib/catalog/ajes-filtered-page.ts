import {AjesUnavailable} from './ajes-client';
import {AjesInputError} from './ajes-query';

type SourcePage<T> = {items:T[]; received:number; partial?:boolean; stale?:boolean};
/** Fill a visible page, keeping a bounded continuation into already filtered source pages.
 * No background crawling: at most eight requested pages, with the existing supplier cache.
 * The skip is within the accepted rows of one source page, never a guessed raw offset.
 */
export async function readFilteredAjesPage<T>(options:{
 startedAt?:number; page:number; pageSize:number; after?:unknown; sourceTotal?:number;
 read:(page:number)=>Promise<SourcePage<T>>; now?:()=>number;
}) {
 const {pageSize,read}=options,now=options.now??Date.now,started=options.startedAt??now();
 let sourcePage=options.page,skip=0;
 if(options.after!==undefined&&options.after!==''){
  const match=/^([1-9]\d{0,6})\.(\d{1,2})$/.exec(String(options.after));
  if(!match||Number(match[1])>1_000_000||Number(match[2])>=pageSize)throw new AjesInputError();
  sourcePage=Number(match[1]);skip=Number(match[2]);
 }
 const items:T[]=[];
 let exhausted=false,partial=false,stale=false,reads=0,interrupted=false;
 while(reads<8&&(reads===0||now()-started<8000)){
  let result:SourcePage<T>;
  try{result=await read(sourcePage);}catch(error){
   const recoverable=error instanceof AjesUnavailable&&(/^(?:http_(?:429|5\d\d)|visitor_restricted|quota_exhausted|quota_busy|local_busy|request_failed|request_timeout|connect_timeout|invalid_response|empty_response)$/.test(error.reason));
   if(!reads||!recoverable)throw error;
   // Keep successful rows and retry this exact source page on explicit continuation.
   interrupted=true;break;
  }
  reads++;
  partial ||= Boolean(result.partial);stale ||= Boolean(result.stale);
  const available=result.items.slice(skip),take=Math.min(pageSize-items.length,available.length);
  items.push(...available.slice(0,take));skip+=take;
  const atEnd=Boolean(result.partial)||result.received<pageSize||(!result.stale&&options.sourceTotal!==undefined&&sourcePage*pageSize>=options.sourceTotal);
  if(skip>=result.items.length){sourcePage++;skip=0;exhausted=atEnd;}
  if(partial){exhausted=true;break;}
  if(exhausted||items.length===pageSize)break;
 }
 return {items,partial,stale,interrupted,hasMore:!exhausted,nextCursor:exhausted?null:`${sourcePage}.${skip}`,scanLimited:!exhausted&&items.length<pageSize,reads};
}
