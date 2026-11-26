import {createHash} from 'node:crypto';
import {AjesUnavailable} from './ajes-client';
import {AjesInputError} from './ajes-query';

type SourcePage<T> = {items:T[]; received:number; partial?:boolean; stale?:boolean; observedAt?:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Fill one visible page from at most eight ordinary source pages. The skip is
 * within the accepted rows, never a guessed raw offset. New bound cursors reject
 * a changed query or changed accepted membership at a partly consumed page;
 * they do not claim a snapshot of source pages that have not been read yet.
 */
export async function readFilteredAjesPage<T>(options:{
 startedAt?:number; page:number; pageSize:number; after?:unknown; sourceTotal?:number;
 read:(page:number)=>Promise<SourcePage<T>>; now?:()=>number;
 minimumReads?:1|2; cursorKey?:string; itemKey?:(item:T)=>string;
}) {
 const {pageSize,read}=options,now=options.now??Date.now,started=options.startedAt??now();
 const bound=options.cursorKey!==undefined&&options.itemKey!==undefined;
 const queryHash=bound?digest([pageSize,options.cursorKey]):undefined;
 let sourcePage=options.page,skip=0,expectedMembership:string|undefined;
 if(options.after!==undefined&&options.after!==''){
  const after=String(options.after);
  const current=/^j1\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64}|-)$/.exec(after);
  if(current){
   sourcePage=Number(current[1]);skip=Number(current[2]);
   if(!bound||Number(current[3])!==options.page||current[4]!==queryHash||(skip===0)!==(current[5]==='-'))throw new AjesInputError();
   expectedMembership=current[5]==='-'?undefined:current[5];
  }else{
   // Preserve already issued offset cursors. Newly emitted Japanese cursors
   // always carry the current query and accepted-membership binding.
   const legacy=/^([1-9]\d{0,6})\.(\d{1,2})$/.exec(after);
   if(!legacy)throw new AjesInputError();
   sourcePage=Number(legacy[1]);skip=Number(legacy[2]);
  }
  if(sourcePage>1_000_000||skip>=pageSize)throw new AjesInputError();
 }
 const items:T[]=[];
 let exhausted=false,partial=false,stale=false,reads=0,interrupted=false,halted=false;
 let membership:string|undefined,observedAt:string|undefined,observedTime=Infinity;
 const minimumReads=options.minimumReads===2?2:1;
 while(reads<8&&(reads<minimumReads||now()-started<8000)){
  let result:SourcePage<T>;
  try{result=await read(sourcePage);}catch(error){
   const recoverable=error instanceof AjesUnavailable&&(/^(?:http_(?:429|5\d\d)|visitor_restricted|quota_exhausted|quota_busy|local_busy|request_failed|request_timeout|connect_timeout|invalid_response|empty_response)$/.test(error.reason));
   if(!reads||!recoverable)throw error;
   // Keep successful rows, mark the result incomplete, and retry this exact
   // source page only on an explicit continuation.
   interrupted=true;partial=true;break;
  }
  reads++;
  membership=bound?digest([result.received,result.items.map(options.itemKey!)]):undefined;
  if(expectedMembership!==undefined&&membership!==expectedMembership)throw new AjesInputError();
  expectedMembership=undefined;
  const time=typeof result.observedAt==='string'?Date.parse(result.observedAt):NaN;
  if(Number.isFinite(time)&&time<observedTime){observedTime=time;observedAt=result.observedAt;}
  partial ||= Boolean(result.partial);stale ||= Boolean(result.stale);
  const available=result.items.slice(skip),take=Math.min(pageSize-items.length,available.length);
  items.push(...available.slice(0,take));skip+=take;
  const atEnd=result.received<pageSize||(!result.stale&&options.sourceTotal!==undefined&&sourcePage*pageSize>=options.sourceTotal);
  if(skip>=result.items.length){sourcePage++;skip=0;membership=undefined;exhausted=atEnd;}
  // A partial fallback cannot establish a subsequent source offset or a true
  // end. The UI retries the current visible batch instead of crawling it.
  if(result.partial){halted=true;break;}
  if(exhausted||items.length===pageSize)break;
 }
 const hasMore=!exhausted&&!halted;
 const nextCursor=!hasMore?null:bound
  ?'j1.'+sourcePage+'.'+skip+'.'+(options.page+1)+'.'+queryHash+'.'+(skip?membership:'-')
  :sourcePage+'.'+skip;
 return {items,partial,stale,interrupted,hasMore,nextCursor,scanLimited:hasMore&&items.length<pageSize,reads,...(observedAt?{observedAt}:{})};
}
