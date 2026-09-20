import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import sharp from 'sharp';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {catalogAuctionSheetUrls} from '../apps/web/lib/catalog/image-quality.ts';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
import {assertJapanSheetIdentity} from './lib/proauctions-sheet-patch.mjs';
const storage=getJsonStorage(),durable=process.env.JAPAN_SHEET_DURABLE==='1';
const io=Object.fromEntries(['readJson','writeJson','getBinary','putBinary','deleteBinary'].map(k=>[k,storage[k].bind(storage)]));
for(const k of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[k]=async()=>{throw Error('collection_read_only');};
const prefix='catalog/collector-state/japan-missing-sheets/',pointer=prefix+'current.json';
const validKey=key=>/^catalog\/collector-state\/japan-missing-sheets\/archive-\d+\.json\.gz$/.test(key||'');
let state={version:1,startedAt:new Date().toISOString(),patches:[]};
if(durable){const meta=await io.readJson(pointer,null);if(meta&&Date.now()-Date.parse(meta.startedAt)<86400000){if(!validKey(meta.key))throw Error('invalid_checkpoint_path');const blob=await io.getBinary(meta.key);if(blob.checksum!==meta.checksum)throw Error('checkpoint_checksum_mismatch');state=JSON.parse(gunzipSync(blob.data,{maxOutputLength:32000000}).toString());if(state.version!==1||!Array.isArray(state.patches))throw Error('invalid_checkpoint');}}
const rows=(await readMarketOffers('japan')).filter(row=>row.sourceId==='proauctions_japan_stat'&&!catalogAuctionSheetUrls(row).length);
const patches=new Map(state.patches.map(p=>[p.id,p]));
const limit=Number(process.env.JAPAN_SHEET_LIMIT||0);if(!Number.isSafeInteger(limit)||limit<0)throw Error('invalid_limit');
const chosen=limit?rows.slice(0,limit):rows;
const report={startedAt:state.startedAt,missing:rows.length,limit:chosen.length,resumed:patches.size,scanned:0,recovered:0,noSheet:0,failed:[],stopReason:'complete'};
const sha=b=>createHash('sha256').update(b).digest('hex');
let lastRequest=0,consecutiveErrors=0;
async function bytes(url,max){
 await new Promise(r=>setTimeout(r,Math.max(0,lastRequest+600-Date.now())));lastRequest=Date.now();
 const response=await fetch(url,{redirect:'error',headers:{'user-agent':'AvtoCena source import/1.0'},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Object.assign(Error('source_http_'+response.status),{blocked:[401,403,429].includes(response.status)});
 const parts=[];let size=0;for await(const b of response.body){size+=b.length;if(size>max)throw Error('response_too_large');parts.push(b);}return Buffer.concat(parts);
}
async function save(){
 state.patches=[...patches.values()];
 if(!durable)return;
 const old=await io.readJson(pointer,null),key=prefix+`archive-${Date.now()}.json.gz`,body=gzipSync(Buffer.from(JSON.stringify(state)));
 if(body.length>8000000)throw Error('checkpoint_size_limit');
 const saved=await io.putBinary(key,body,'application/gzip');
 await io.writeJson(pointer,{key,checksum:saved.checksum,previousKey:old?.key||null,startedAt:state.startedAt,records:patches.size,savedAt:new Date().toISOString()});
 if(validKey(old?.previousKey))await io.deleteBinary(old.previousKey);
}
const deadline=Date.now()+7200000;
for(const row of chosen){
 if(patches.has(row.id)){report.scanned++;continue;}
 if(Date.now()>deadline){report.stopReason='time_budget';break;}
 try{
  const url=row.operational?.sourceUrl;if(!/^https:\/\/demo\.pro-auctions\.ru\/statistika\/[^/?#]+\/[^/?#]+\/\d+\.html$/.test(url||''))throw Error('unexpected_source_url');
  const html=await bytes(url,3000000),e=parseProAuctionsDetailEvidence(html.toString('utf8'),url);
  const identity=assertJapanSheetIdentity(row,e),sheets=[];
  for(const url of e.auctionSheetUrls){
   const body=await bytes(url,12000000),decoded=await sharp(body,{limitInputPixels:40000000}).rotate().raw().toBuffer({resolveWithObject:true});
   if(decoded.info.width<100||decoded.info.height<100)throw Error('sheet_too_small');const checksum=sha(decoded.data);
   sheets.push({role:'auction_sheet',id:checksum,url,objectKey:'',checksum,width:decoded.info.width,height:decoded.info.height,size:body.length,mimeType:'image/webp'});
  }
  patches.set(row.id,{id:row.id,...identity,sourceUrl:url,evidenceSha256:sha(html),checkedAt:new Date().toISOString(),sheets});
  report.recovered+=Number(sheets.length>0);report.noSheet+=Number(!sheets.length);consecutiveErrors=0;
 }catch(error){report.failed.push({id:String(row.sourceOfferId),error:String(error)});consecutiveErrors++;if(error.blocked)report.stopReason='source_access_refused';else if(consecutiveErrors>=3)report.stopReason='source_unavailable';}
 report.scanned++;
 if(report.scanned%50===0){await save();console.log(JSON.stringify({...report,failed:report.failed.length}));}
 if(report.stopReason!=='complete')break;
}
await save();
const out='proauctions-detail-patches';await fs.mkdir(out,{recursive:true});
// Include durable successful patches as well as this attempt's failures. Never
// let a partial source response turn into removal of a published vehicle.
for(const p of patches.values())await fs.writeFile(`${out}/${p.sourceOfferId}.json`,JSON.stringify(p));
report.complete=report.scanned===chosen.length&&!report.failed.length;
report.scanned=patches.size+new Set(report.failed.map(x=>x.id)).size;
report.completedAt=new Date().toISOString();
await fs.writeFile(`${out}/summary.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(!report.complete)process.exitCode=1;
