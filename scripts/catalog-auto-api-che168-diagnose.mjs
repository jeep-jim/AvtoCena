import {autoApiChe168Client, autoApiPage, autoApiChe168Detail, collectAutoApiChe168} from './lib/auto-api-che168-client.mjs';
import {autoApiChe168RejectionReason} from '../apps/web/lib/catalog/auto-api-che168.ts';

// Read-only bounded inspection. Never log the response body, contacts or credentials.
const baseRequest=autoApiChe168Client({apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+12*60000});
const diagnosticCursor=Number(process.env.CHE168_DIAGNOSE_CHANGE_ID || '');
if (Number.isSafeInteger(diagnosticCursor) && diagnosticCursor >= 0) {
 let mismatch=null,rejection=null,offerChecks=0,removals=0;
 const request=async(endpoint,params)=>{
  const payload=await baseRequest(endpoint,params);
  if(endpoint==='offer'){
   offerChecks++;
   const expected=String(params.inner_id);
   try{autoApiChe168Detail(payload,expected);}catch{
    const row=payload?.inner_id ? payload : payload?.result;
    mismatch={expected,
     responseKind:Array.isArray(payload)?'array':payload===null?'null':typeof payload,
     resultKind:Array.isArray(payload?.result)?'array':payload?.result===null?'null':typeof payload?.result,
     resultLength:Array.isArray(payload?.result)?payload.result.length:null,
     hasDirectId:payload?.inner_id!==undefined,
     hasResultId:payload?.result?.inner_id!==undefined,
     idMatches:String(row?.inner_id)===expected,
     hasData:!!row?.data,
     hasDirectUrl:typeof payload?.url==='string',
     hasDirectMake:typeof payload?.mark==='string' && !!payload.mark,
     hasDirectModel:typeof payload?.model==='string' && !!payload.model,
     hasDirectYear:Number.isFinite(Number(payload?.year)),
     hasPositiveDirectPrice:Number(payload?.price)>0};
    console.log(JSON.stringify({diagnostic:'che168_detail_mismatch',...mismatch,expected:undefined}));
   }
  }
  return payload;
 };
 try {
  await collectAutoApiChe168({request,yearFrom:2020,
   resume:{cursor:diagnosticCursor,snapshotStartedAt:process.env.CHE168_DIAGNOSE_SNAPSHOT_AT || new Date().toISOString()},
   onOffer:async row=>{const reason=autoApiChe168RejectionReason(row);if(reason && reason!=='missing_model'){
    rejection=reason;const data=row?.data||{};
    console.log(JSON.stringify({diagnostic:'che168_change_rejection',reason,
     idMatches:String(row?.inner_id)===String(data?.inner_id),hasUrl:typeof data.url==='string',
     hasMake:typeof data.mark==='string'&&!!data.mark,hasModel:typeof data.model==='string'&&!!data.model,
     hasYear:Number.isFinite(Number(data.year)),hasPositivePrice:Number(data.price)>0}));
    throw Error('auto_api_diagnostic_rejection');}},onRemoval:async()=>{removals++;},
   onProgress:async progress=>console.log(JSON.stringify({diagnostic:'che168_change_progress',changes:progress.changes,cursor:progress.cursor}))});
  console.log(JSON.stringify({diagnosticComplete:true,mode:'changes',mismatch:false,offerChecks,removals,productionWrites:false}));
 } catch(error) {
  if(error?.message==='auto_api_diagnostic_rejection' && rejection){
   console.log(JSON.stringify({diagnosticComplete:true,mode:'changes',rejection,offerChecks,removals,productionWrites:false}));
   process.exit(0);
  }
  if(error?.message!=='auto_api_detail_identity_mismatch' || !mismatch)throw error;
  let cursor=diagnosticCursor,pages=0,eventCount=0,latestType=null;
  const scanPages=Math.max(0,Math.min(1000,Number(process.env.CHE168_DIAGNOSE_SCAN_PAGES ?? 1000)));
  while(pages<scanPages){
   const payload=await baseRequest('changes',{change_id:cursor});
   if(!Array.isArray(payload?.result)||payload?.meta?.cur_change_id!==cursor)throw Error('auto_api_invalid_changes');
   for(const event of payload.result)if(String(event?.inner_id)===mismatch.expected){eventCount++;latestType=event.change_type;}
   if(!payload.result.length)break;
   const next=payload.meta.next_change_id;
   if(!Number.isSafeInteger(next)||next<=cursor)throw Error('auto_api_stalled_changes');
   cursor=next;pages++;
  }
  console.log(JSON.stringify({diagnosticComplete:true,mode:'changes',mismatch:true,offerChecks,removals,
   mismatchedListingEvents:eventCount,latestEventType:latestType,changePagesInspected:pages,productionWrites:false}));
 }
 process.exit(0);
}

const request=baseRequest;
let pages=0,rows=0,rejected=0,page=1;
const reasons={};
while(page!==null && pages<250 && rejected<10){
 const result=autoApiPage(await request('offers',{page,year_from:2020}),page);
 for(const row of result.items){
  rows++;const reason=autoApiChe168RejectionReason(row);if(!reason)continue;
  rejected++;reasons[reason]=(reasons[reason]||0)+1;
  const safeId=/^\d+$/.test(String(row?.inner_id))?String(row.inner_id):null;
  let sourcePath=null;try{const u=new URL(row?.data?.url);if(u.hostname==='www.che168.com')sourcePath=u.pathname.replace(/[^a-zA-Z0-9/._-]/g,'').slice(0,180);}catch{}
  console.log(JSON.stringify({reason,innerId:safeId,sourcePath,hasMake:!!row?.data?.mark,hasModel:!!row?.data?.model,year:typeof row?.data?.year==='number'?row.data.year:null,hasPositivePrice:Number(row?.data?.price)>0}));
 }
 pages++;page=result.next;
}
console.log(JSON.stringify({diagnosticComplete:true,pages,rows,rejected,reasons,productionWrites:false}));
