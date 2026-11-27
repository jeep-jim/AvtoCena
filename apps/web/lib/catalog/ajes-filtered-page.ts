import {createHash} from 'node:crypto';
import {AjesUnavailable} from './ajes-client';
import {AjesInputError,AjesCursorRefreshRequired} from './ajes-query';

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

type PowerPhase='k'|'u';
const powerCursor=/^j2\.([ku])\.([1-9]\d{0,6})\.(\d{1,2})\.([1-9]\d{0,6})\.([a-f0-9]{64})\.([a-f0-9]{64})\.([a-f0-9]{64}|-)$/;
const hash64=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Hash only: neither editorial entries nor their private revision are public. */
export function ajesPowerEvidenceEpoch(value:{runtimeSha:unknown;editorialRevision:unknown;calculationDigest:unknown}):string {
 if(typeof value.runtimeSha!=='string'||!/^[a-f0-9]{40}$/.test(value.runtimeSha)
  ||typeof value.editorialRevision!=='string'||!value.editorialRevision||value.editorialRevision.length>128
  ||value.calculationDigest!==null&&!hash64(value.calculationDigest))throw new AjesUnavailable('not_configured');
 return digest(['japan-known-before-unknown-v1',value.runtimeSha,value.editorialRevision,value.calculationDigest]);
}

/** Check the local epoch before model/make resolution can read the source.
 * Old mixed-power cursors are not positions in the new two-pass sequence.
 */
export function assertAjesPowerCursorEpoch(options:{page:number;pageSize:number;after?:unknown;evidenceEpoch:string}) {
 if(!hash64(options.evidenceEpoch)||!Number.isSafeInteger(options.page)||options.page<1||options.page>1_000_000
  ||!Number.isSafeInteger(options.pageSize)||options.pageSize<1||options.pageSize>48)throw new AjesInputError();
 if(options.after===undefined||options.after===''){
  if(options.page!==1)throw new AjesCursorRefreshRequired();
  return;
 }
 if(typeof options.after!=='string'||options.after.length>320)throw new AjesCursorRefreshRequired();
 const match=powerCursor.exec(options.after);
 if(!match||Number(match[2])>1_000_000||Number(match[3])>options.pageSize||Number(match[4])!==options.page
  ||match[6]!==options.evidenceEpoch||(Number(match[3])===0)!==(match[7]==='-'))throw new AjesCursorRefreshRequired();
}

/** Visitor-driven K then U traversal of the unchanged source query. There is
 * one read/start-time budget across both phases; no eager scan or saved mirror.
 * A stale/partial page remains at its exact offset until a fresh read confirms
 * its membership. Only fresh, complete source exhaustion can start U.
 */
export async function readPowerOrderedAjesPage<T>(options:{
 startedAt?:number;page:number;pageSize:number;after?:unknown;evidenceEpoch:string;cursorKey:string;
 read:(page:number,phase:PowerPhase)=>Promise<SourcePage<T>>;known:(item:T)=>boolean;itemKey:(item:T)=>string;
 now?:()=>number;minimumReads?:1|2;
}) {
 assertAjesPowerCursorEpoch(options);
 const {pageSize,read}=options,now=options.now??Date.now,started=options.startedAt??now();
 const queryHash=digest([pageSize,options.cursorKey,'japan-known-before-unknown-v1']);
 let phase:PowerPhase='k',sourcePage=1,skip=0,expectedMembership:string|undefined;
 if(options.after){
  const match=powerCursor.exec(String(options.after))!;
  if(match[5]!==queryHash)throw new AjesCursorRefreshRequired();
  phase=match[1] as PowerPhase;sourcePage=Number(match[2]);skip=Number(match[3]);
  expectedMembership=match[7]==='-'?undefined:match[7];
 }
 const items:T[]=[];
 let exhausted=false,partial=false,stale=false,interrupted=false,reads=0;
 let membership:string|undefined,observedAt:string|undefined,observedTime=Infinity;
 const minimumReads=options.minimumReads===2?2:1;
 while(reads<8&&(reads<minimumReads||now()-started<8000)){
  let result:SourcePage<T>;
  try{result=await read(sourcePage,phase);}catch(error){
   const recoverable=error instanceof AjesUnavailable&&(/^(?:http_(?:429|5\d\d)|visitor_restricted|quota_exhausted|quota_busy|local_busy|request_failed|request_timeout|connect_timeout|invalid_response|empty_response)$/.test(error.reason));
   if(!reads||!recoverable)throw error;
   interrupted=true;partial=true;break;
  }
  reads++;
  const selected=result.items.filter(item=>options.known(item)===(phase==='k'));
  membership=digest([result.received,selected.map(options.itemKey)]);
  if(expectedMembership!==undefined&&membership!==expectedMembership)throw new AjesCursorRefreshRequired();
  expectedMembership=undefined;
  if(skip>selected.length)throw new AjesCursorRefreshRequired();
  const time=typeof result.observedAt==='string'?Date.parse(result.observedAt):NaN;
  if(Number.isFinite(time)&&time<observedTime){observedTime=time;observedAt=result.observedAt;}
  partial ||= Boolean(result.partial)||!Number.isFinite(time);stale ||= Boolean(result.stale);
  const available=selected.slice(skip),take=Math.min(pageSize-items.length,available.length);
  items.push(...available.slice(0,take));skip+=take;
  if(result.partial||result.stale||!Number.isFinite(time))break;
  if(skip>=selected.length){
   skip=0;membership=undefined;
   if(result.received<pageSize){
    if(phase==='k'){phase='u';sourcePage=1;}
    else{exhausted=true;break;}
   }else{
    if(sourcePage===1_000_000)throw new AjesCursorRefreshRequired();
    sourcePage++;
   }
  }
  if(items.length===pageSize)break;
 }
 const hasMore=!exhausted;
 if(hasMore&&options.page===1_000_000)throw new AjesCursorRefreshRequired();
 const nextCursor=hasMore?'j2.'+phase+'.'+sourcePage+'.'+skip+'.'+(options.page+1)+'.'+queryHash+'.'+options.evidenceEpoch+'.'+(skip?membership:'-'):null;
 return {items,partial,stale,interrupted,hasMore,nextCursor,scanLimited:hasMore&&items.length<pageSize,reads,...(observedAt?{observedAt}:{})};
}
