import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {parseProAuctionsDetailEvidence,proAuctionsText} from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
import {proAuctionsIdentity,matchingProAuctionsSale,proAuctionsOffer,proAuctionsSaleWitness} from '../apps/web/lib/catalog/proauctions-import.ts';
import {saveProAuctionsState} from './lib/proauctions-durable-state.mjs';
import {proAuctionsCollectionStopReason} from './lib/proauctions-collection-stop.mjs';

const root=process.env.PROAUCTIONS_OUTPUT || 'proauctions-collection';
const deadline=Date.now()+Number(process.env.PROAUCTIONS_SECONDS || 4500)*1000;
const maxDetails=Number(process.env.PROAUCTIONS_MAX_DETAILS || 0);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
for(const folder of ['raw','offers','html','witness'])await fs.mkdir(path.join(root,folder),{recursive:true});
let state={startedAt:new Date().toISOString(),page:1,pending:[],done:[],pages:0,details:0,prepared:0,errors:[],stopReason:'',complete:false};
try{state=JSON.parse(await fs.readFile(path.join(root,'checkpoint.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const done=new Set(state.done), lastRequest=new Map();
let witnessBlocked=false;
async function get(url,limit=3000000){
  const u=new URL(url);
  if(u.protocol!=='https:' || !/^(demo\.pro-auctions\.ru|jptrade\.ru|jp\d+\.pa-server\.ru)$/.test(u.hostname) || u.port || u.username || u.password)throw Error('unexpected_host');
  const start=Math.max(Date.now(),(lastRequest.get(u.hostname)||0)+400);lastRequest.set(u.hostname,start);await pause(start-Date.now());
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{headers:{'user-agent':'AvtoCena source import/1.0'},signal:AbortSignal.timeout(25000),redirect:'error'});
      if([401,403,429].includes(r.status))throw Object.assign(Error(`access_${r.status}`),{access:true});
      if(r.status>=500 && attempt<2){await pause(1500*(attempt+1));continue;}
      if(!r.ok)throw Error(`http_${r.status}`);
      const chunks=[];let size=0;for await(const b of r.body){size+=b.length;if(size>limit)throw Error('response_too_large');chunks.push(b);}
      return Buffer.concat(chunks);
    }catch(e){if(e.access || !/timeout|fetch failed/i.test(String(e)) || attempt===2)throw e;await pause(1500*(attempt+1));}
  }
}
async function readParts(dir){let rows=[];try{for(const f of await fs.readdir(dir,{recursive:true}))if(/part-[^/]+\.json$/.test(f))rows.push(...JSON.parse(await fs.readFile(path.join(dir,f),'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}return rows;}
const witnesses=await readParts('saved-jptrade');
const key=e=>`${e.auctionDate}|${String(e.auctionName).toLowerCase().replace(/[^a-z0-9]/g,'')}|${e.lotNumber}`;
const byKey=new Map();for(const w of witnesses){const k=key(w);byKey.set(k,[...(byKey.get(k)||[]),w]);}
// Seed the previously collected URLs first; each is refreshed exactly once.
if(!state.details && !state.pending.length){
  const seeds=await readParts('saved-proauctions');
  seeds.sort((a,b)=>Number(byKey.has(key(b)))-Number(byKey.has(key(a))));
  state.pending=[...new Set(seeds.map(r=>r.sourceUrl))];
}
async function checkpoint(force=false){state.startedAt ||= new Date().toISOString();state.done=[...done];state.checkedAt=new Date().toISOString();await fs.writeFile(path.join(root,'checkpoint.tmp'),JSON.stringify(state));await fs.rename(path.join(root,'checkpoint.tmp'),path.join(root,'checkpoint.json'));await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({...state,done:done.size,pending:state.pending.length},null,2));console.log(JSON.stringify({pages:state.pages,details:state.details,prepared:state.prepared,pending:state.pending.length,stopReason:state.stopReason}));await saveProAuctionsState(root,state,force);}
async function detail(url,cached=false){
  const id=url.match(/\/(\d+)\.html$/)?.[1];if(!id || !url.startsWith('https://demo.pro-auctions.ru/statistika/'))throw Error('unexpected_detail_url');
  const buffer=cached?gunzipSync(await fs.readFile(path.join(root,'html',`${id}.html.gz`))):await get(url),body=buffer.toString('utf8');
  await fs.writeFile(path.join(root,'html',`${id}.html.gz`),gzipSync(buffer));
  let record={sourceUrl:url,sourceId:id,evidenceSha256:sha(buffer),fetchedAt:new Date().toISOString()};
  try{
    const e=parseProAuctionsDetailEvidence(body,url),identity=proAuctionsIdentity(body,e);
    record={...record,evidence:e,identity};
    const matches=(byKey.get(key(e.identity))||[]).filter(w=>matchingProAuctionsSale(e,identity,w));
    let witness=matches.length===1?matches[0]:null;
    if(!e.price.saleConfirmed && !witness && !witnessBlocked){
      try{const bytes=cached?gunzipSync(await fs.readFile(path.join(root,'witness',`${id}.html.gz`))):await get(`https://jptrade.ru/stat/${id}`);await fs.writeFile(path.join(root,'witness',`${id}.html.gz`),gzipSync(bytes));
        const w=proAuctionsSaleWitness(bytes.toString('utf8'),id);if(matchingProAuctionsSale(e,identity,w))witness=w;
      }catch(error){record.witnessError=String(error);if(error.access)witnessBlocked=true;}
    }
    record.saleWitness=witness;
    const date=Date.parse(e.identity.auctionDate);
    if(!e.price.saleConfirmed && !witness)record.reason='sold_price_unconfirmed';
    else if(Date.now()-date>30*86400000 || date>Date.now())record.reason='auction_outside_retention';
    else{
      const photos=[];
      for(const imageUrl of [...e.imageUrls.slice(0,30),...e.auctionSheetUrls]){
        try{const bytes=await get(imageUrl,12000000);const decoded=await sharp(bytes,{limitInputPixels:40000000}).rotate().raw().toBuffer({resolveWithObject:true});
          photos.push({url:imageUrl,decodedSha256:sha(decoded.data),width:decoded.info.width,height:decoded.info.height,size:bytes.length,mimeType:'image/webp'});
        }catch(error){record.imageErrors=[...(record.imageErrors||[]),{url:imageUrl,error:String(error)}];if(error.access)break;}
      }
      record.photos=photos;
      const offer=proAuctionsOffer(e,identity,witness,photos,record.evidenceSha256);
      if(offer){await fs.writeFile(path.join(root,'offers',`${id}.json`),JSON.stringify(offer));state.prepared++;record.reason='prepared';}
      else record.reason='identity_image_or_retention_gate';
    }
  }catch(error){record.reason=String(error);}
  await fs.writeFile(path.join(root,'raw',`${id}.json`),JSON.stringify(record));if(!done.has(url))state.details++;done.add(url);
}
// Reinterpret saved witness dates from the first smoke without recollecting HTML.
if(state.contractVersion!==2){
  for(const f of await fs.readdir(path.join(root,'raw'))){
    const record=JSON.parse(await fs.readFile(path.join(root,'raw',f),'utf8'));
    if(record.reason!=='sold_price_unconfirmed')continue;
    try{await fs.access(path.join(root,'witness',`${record.sourceId}.html.gz`));await detail(record.sourceUrl,true);}catch(error){state.errors.push({url:record.sourceUrl,error:String(error)});}
  }
  state.contractVersion=2;await checkpoint();
}
if(!state.complete){
  state.stopReason='';
  try{
    while(Date.now()<deadline && (!maxDetails || state.details<maxDetails)){
      state.pending=state.pending.filter(u=>!done.has(u));
      if(!state.pending.length){
        const url=`https://demo.pro-auctions.ru/statistika/?page=${state.page}`;
        const body=(await get(url)).toString('utf8');
        const links=[...new Set([...body.matchAll(/href=["']((?:https:\/\/demo\.pro-auctions\.ru)?\/statistika\/[^"']+\/\d+\.html)["']/g)].map(m=>new URL(m[1],url).href))];
        if(!links.length){state.stopReason='no_detail_links';state.complete=true;break;}
        const fingerprint=sha(links.join('\n'));
        if(fingerprint===state.lastListFingerprint){state.stopReason='repeated_listing_page';break;}
        state.lastListFingerprint=fingerprint;state.pending=links.filter(u=>!done.has(u));state.page++;state.pages++;
        if(!state.pending.length){await checkpoint();continue;}
      }
      const batch=state.pending.slice(0,maxDetails?Math.min(3,maxDetails-state.details):3);
      // Array.map's second argument is an index, not our explicit cache flag.
      const results=await Promise.allSettled(batch.map(url=>detail(url)));
      state.pending=state.pending.filter(u=>!done.has(u));
      let fatal=null;
      for(let i=0;i<results.length;i++)if(results[i].status==='rejected'){const error=results[i].reason;state.errors.push({url:batch[i],error:String(error)});fatal=error;}
      await checkpoint();
      if(fatal){state.stopReason=proAuctionsCollectionStopReason(fatal);break;}
    }
    state.stopReason ||= 'time_budget_checkpointed';
  }catch(error){
    state.errors.push({url:`https://demo.pro-auctions.ru/statistika/?page=${state.page}`,error:String(error)});
    state.stopReason=proAuctionsCollectionStopReason(error);
  }finally{await checkpoint(true);}
}

if(["source_access_refused","transport_error_checkpointed","repeated_listing_page"].includes(state.stopReason))process.exitCode=1;
