import {createHash,randomBytes} from 'node:crypto';
import {AjesUnavailable} from './ajes-access-policy';
import {AjesInputError} from './ajes-query';
import type {JapanPowerPhase,JapanPowerSnapshot} from './japan-power-query';

// Snapshot identity belongs to the server continuation reader. The SQL/image
// helper is also imported by browser galleries and must remain browser-safe.
export function japanPowerSnapshot(index:JapanPowerSnapshot['index'],editorial:JapanPowerSnapshot['editorial']):JapanPowerSnapshot{
 const revision=createHash('sha256').update(JSON.stringify(['japan-power-order-v1',index?.digest||'none',editorial.revision])).digest('hex');
 return {index,editorial,revision};
}

type Row={id:string};
type SourcePage<T>={items:T[];received:number;observedAt:string;sourceFingerprint:string;partial?:boolean;stale?:boolean;[key:string]:any};
type Position={phase:JapanPowerPhase;sourcePage:number;skip:number};
type Page<T>={start:Position;position:Position;items:T[];ids:string[];locations:Set<string>;touched:number;observedAt?:string;bodyEvicted?:boolean;complete:boolean;exhausted:boolean;partial:boolean;stale:boolean;interrupted:boolean;received:number;first?:Omit<SourcePage<T>,'items'>;firstKey?:string;};
type Session<T>={id:string;identity:string;revision:string;createdAt:number;expiresAt:number;sourceRevision?:string;pages:Map<number,Page<T>>;observations:Map<string,string>;seen:Set<string>;pending?:Promise<unknown>;};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freshMs=30*60_000,staleMs=7*24*60*60_000;
const recoverable=(error:unknown)=>error instanceof AjesUnavailable&&/^(?:http_(?:429|5\d\d)|visitor_restricted|quota_exhausted|quota_busy|local_busy|request_failed|request_timeout|connect_timeout|invalid_response|empty_response)$/.test(error.reason);
const cursorError=()=>new AjesUnavailable('cursor_expired');
/** Only already requested rows/positions are retained. This small, expiring
 * continuation cache is not an inventory or a supplier snapshot. New source
 * pages still pass through the normal real-IP, quota and two-slot reader.
 */
export function createAjesPowerPager(config:{now?:()=>number;maxSessions?:number;maxBytes?:number;maxReads?:number}={}){
 const now=config.now??Date.now,maxSessions=config.maxSessions??32,maxBytes=config.maxBytes??8*1024*1024,maxReads=config.maxReads??8;
 const sessions=new Map<string,Session<any>>(),queries=new Map<string,string>();
 let touch=0;
 const remove=(id:string)=>{const session=sessions.get(id);if(session&&queries.get(session.identity)===id)queries.delete(session.identity);sessions.delete(id);};
 const prune=()=>{for(const [id,session] of sessions)if(session.expiresAt<=now()&&!session.pending)remove(id);};
 const size=(session:Session<any>)=>Buffer.byteLength(JSON.stringify([[...session.pages].map(([number,page])=>[number,{...page,locations:[...page.locations]}]), [...session.observations], [...session.seen]]));
 const retain=(session:Session<any>)=>{
  // Keep only a small rolling window of public-page bodies. Older positions and
  // compact source/ID proofs remain usable for forward continuation; opening an
  // evicted old body fails explicitly rather than walking the whole catalogue.
  const newest=[...session.pages].sort(([,a],[,b])=>b.touched-a.touched).slice(0,4).map(([number])=>number);
  for(const [number,page] of session.pages)if(page.complete&&!newest.includes(number)){page.items=[];page.bodyEvicted=true;}
  sessions.delete(session.id);sessions.set(session.id,session);
  let bytes=[...sessions.values()].reduce((sum,value)=>sum+size(value),0);
  for(const [id,value] of sessions){if(sessions.size<=maxSessions&&bytes<=maxBytes)break;if(value.pending||id===session.id)continue;bytes-=size(value);remove(id);}
  if(bytes>maxBytes){remove(session.id);throw cursorError();}
 };
 const token=(session:Session<any>,page:number)=>`jp1.${session.id}.${page}.${session.identity.slice(0,16)}`;
 return {
  clear(){sessions.clear();queries.clear();},
  async read<T extends Row>(options:{query:Record<string,unknown>;revision:string;page:number;pageSize:number;after?:unknown;partitioned?:boolean;read:(phase:JapanPowerPhase,page:number,pageSize:number)=>Promise<SourcePage<T>>}){
   prune();
   const query=Object.fromEntries(Object.entries(options.query).filter(([key,value])=>!['page','after','marketPage'].includes(key)&&value!==undefined&&value!=='').sort(([a],[b])=>a.localeCompare(b)));
   const identity=digest(['japan-power-order-v1',query,options.pageSize,options.revision,options.partitioned!==false]);
   if(!Number.isInteger(options.page)||options.page<1||options.page>1_000_000||!Number.isInteger(options.pageSize)||options.pageSize<1||options.pageSize>48)throw new AjesInputError();
   let session:Session<T>|undefined;
   if(options.after!==undefined&&options.after!==''){
    const match=/^jp1\.([a-f0-9]{32})\.([1-9]\d{0,6})\.([a-f0-9]{16})$/.exec(String(options.after));
    if(!match||Number(match[2])!==options.page)throw new AjesInputError();
    session=sessions.get(match[1]);
    if(!session||session.revision!==options.revision||session.expiresAt<=now())throw cursorError();
    if(match[3]!==identity.slice(0,16)||session.identity!==identity)throw new AjesInputError();
   }else{session=sessions.get(queries.get(identity)||'');if(options.page===1&&session?.pages.get(1)?.bodyEvicted)session=undefined;}
   // A cold direct page 2 prepares at most two visible pages. Arbitrary page N
   // never authorizes traversing N source pages: use an emitted continuation.
   if(!session){
    if(options.page>2)throw new AjesInputError();
    while(sessions.size>=maxSessions){const idle=[...sessions.values()].find(value=>!value.pending);if(!idle)throw new AjesUnavailable('local_busy');remove(idle.id);}
    session={id:randomBytes(16).toString('hex'),identity,revision:options.revision,createdAt:now(),expiresAt:now()+freshMs,pages:new Map(),observations:new Map(),seen:new Set()};
    sessions.set(session.id,session);queries.set(identity,session.id);
   }
   const active=session;
   while(active.pending)await active.pending;
   if(sessions.get(active.id)!==active||active.expiresAt<=now())throw cursorError();
   let resolvePending!:()=>void;
   active.pending=new Promise<void>(resolve=>{resolvePending=resolve;});
   try{
    const sourceSize=Math.min(48,options.pageSize*2),readValues=new Map<string,SourcePage<T>>();let reads=0,firstReadFinished=0;
    const canRead=()=>reads<maxReads&&(reads<2||now()-firstReadFinished<8000);
    const read=async(phase:JapanPowerPhase,page:number)=>{
     const key=`${phase}.${page}`;
     if(readValues.has(key))return readValues.get(key)!;
     const value=await options.read(phase,page,sourceSize);reads++;
     if(reads===1)firstReadFinished=now();
     const observed=Date.parse(value.observedAt),age=now()-observed;
     if(!Number.isFinite(observed)||age<0||age>=staleMs||!Array.isArray(value.items)||!Number.isSafeInteger(value.received)||value.received<0||value.received>sourceSize||!/^[a-f0-9]{64}$/.test(value.sourceFingerprint||''))throw new AjesUnavailable('invalid_response');
     // Offsets are within the accepted rows. Bind their ordered identities as
     // well: a changed price-filter membership must not silently shift skip.
     // Volatile prices/rate timestamps themselves are deliberately excluded.
     const fingerprint=digest([value.observedAt,value.received,value.sourceFingerprint,value.items.map(item=>item.id)]);
     const previous=active.observations.get(key);
     if(previous&&previous!==fingerprint){remove(active.id);throw cursorError();}
     active.observations.set(key,fingerprint);
     active.sourceRevision??=digest([active.id,active.revision,key,value.observedAt,fingerprint]);
     if(!value.stale)active.expiresAt=Math.min(active.expiresAt,observed+freshMs);
     readValues.set(key,value);return value;
    };
    const fill=async(pageNumber:number):Promise<Page<T>>=>{
     let page=active.pages.get(pageNumber);
     if(!page){
      const previous=active.pages.get(pageNumber-1);
      if(pageNumber!==1&&(!previous?.complete||previous.exhausted))throw new AjesInputError();
      const start=previous?{...previous.position}:{phase:'known' as const,sourcePage:1,skip:0};
      page={start,position:{...start},items:[],ids:[],locations:new Set(),touched:0,complete:false,exhausted:false,partial:false,stale:false,interrupted:false,received:0};
      active.pages.set(pageNumber,page);
     }
     page.touched=++touch;
     if(page.bodyEvicted){
      const keys=[...page.locations];
      if(keys.length>maxReads)throw cursorError();
      const restored=new Map<string,T>();let stale=false,partial=false;
      for(const key of keys){
       if(!canRead())throw cursorError();
       const [phase,number]=key.split('.'),value=await read(phase as JapanPowerPhase,Number(number));
       for(const item of value.items)if(page.ids.includes(item.id))restored.set(item.id,item);
       stale ||= Boolean(value.stale);partial ||= Boolean(value.partial);
      }
      if(restored.size!==page.ids.length)throw cursorError();
      page.items=page.ids.map(id=>restored.get(id)!);page.bodyEvicted=false;page.stale=stale;page.partial=partial;
     }
     // Even an immutable completed page re-enters the existing source reader.
     // Its normal cached path rechecks the visitor and collection permissions;
     // a changed source observation invalidates this continuation explicitly.
     if(page.complete){
      const locations=page.locations.size?[...page.locations]:[`${page.start.phase}.${page.start.sourcePage}`];
      if(locations.length>maxReads)throw cursorError();
      let stale=false,partial=false;
      for(const key of locations){
       if(!readValues.has(key)&&!canRead())throw cursorError();
       const [phase,number]=key.split('.'),checked=await read(phase as JapanPowerPhase,Number(number));
       stale ||= Boolean(checked.stale);partial ||= Boolean(checked.partial);
      }
      page.partial=partial||stale;page.stale=stale;return page;
     }
     page.partial=false;page.stale=false;page.interrupted=false;
     if(page.items.length){
      try{const checked=await read(page.start.phase,page.start.sourcePage);if(checked.partial||checked.stale){page.partial=true;page.stale=Boolean(checked.stale);return page;}}
      catch(error){if(!recoverable(error))throw error;page.partial=true;page.interrupted=true;return page;}
     }
     while(canRead()||readValues.has(`${page.position.phase}.${page.position.sourcePage}`)){
      const {phase,sourcePage,skip}=page.position;let result:SourcePage<T>;
      try{result=await read(phase,sourcePage);}catch(error){
       if(!recoverable(error)||!page.items.length)throw error;
       page.partial=true;page.interrupted=true;break;
      }
      if(!page.first){
       // Cursor metadata is durable; read/attempt evidence belongs only to the
       // current catalogue invocation and must never be replayed from it.
       const {items:_sourceItems,sourceReadReceipt:_sourceReceipt,sourceReadReceipts:_sourceReceipts,
        catalogReadReceipt:_catalogReceipt,sourceReadReceiptsLimited:_receiptsLimited,...metadata}=result;
       page.first=metadata;
      }page.firstKey??=`${phase}.${sourcePage}`;
      page.received+=result.received;
      page.partial ||= Boolean(result.partial);page.stale ||= Boolean(result.stale);
      let next=skip;
      while(next<result.items.length&&page.items.length<options.pageSize){
       const item=result.items[next++];
       if(!item?.id||active.seen.has(item.id))continue;
       active.seen.add(item.id);page.items.push(item);page.ids.push(item.id);page.locations.add(`${phase}.${sourcePage}`);
       if(!page.observedAt||Date.parse(result.observedAt)<Date.parse(page.observedAt))page.observedAt=result.observedAt;
      }
      page.position.skip=next;
      const consumed=next===result.items.length;
      // Saved/partial rows are useful, but never prove that all known cars were
      // exhausted. Unknown rows cannot leapfrog a failed known continuation.
      if(result.partial||result.stale){page.partial=true;break;}
      if(consumed){
       if(result.received<sourceSize){
        if(phase==='known'&&options.partitioned!==false)page.position={phase:'unknown',sourcePage:1,skip:0};
        else page.exhausted=true;
       }else page.position={phase,sourcePage:sourcePage+1,skip:0};
      }
      if(page.items.length===options.pageSize||page.exhausted){page.complete=true;break;}
     }
     if(!page.complete)page.partial=true;
     return page;
    };
    if(options.page===2&&!active.pages.has(1))await fill(1);
    if(options.page===2&&!active.pages.get(1)?.complete){
     // Do not relabel an incomplete first page as page 2 or skip its rows.
     retain(active);throw new AjesUnavailable('pagination_pending');
    }
    const page=await fill(options.page);
    retain(active);
    const hasMore=page.complete&&!page.exhausted&&!page.partial&&!page.stale;
    return {...page.first,observedAt:page.observedAt??page.first?.observedAt,items:[...page.items],page:options.page,pageSize:options.pageSize,received:page.received,partial:page.partial,stale:page.stale,interrupted:page.interrupted,
     hasMore,nextCursor:hasMore?token(active,options.page+1):null,retryCursor:!page.complete?token(active,options.page):undefined,
     previousCursor:options.page>1&&active.pages.has(options.page-1)?token(active,options.page-1):undefined,
     scanLimited:!page.complete&&!page.interrupted,sourceRevision:active.sourceRevision,generationId:active.sourceRevision,reads};
   }finally{
    active.pending=undefined;resolvePending();
    if(!active.sourceRevision)remove(active.id);
    else if(sessions.get(active.id)===active)try{retain(active);}catch{remove(active.id);}
   }
  },
 };
}
const sharedPowerPager=createAjesPowerPager();
export const readPowerAjesPage:ReturnType<typeof createAjesPowerPager>['read']=options=>sharedPowerPager.read(options);
