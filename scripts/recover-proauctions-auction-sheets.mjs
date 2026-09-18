import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
const root=process.env.PROAUCTIONS_ARCHIVE || 'proauctions-collection';
const out='proauctions-detail-patches';await fs.mkdir(out,{recursive:true});
const stats={scanned:0,withSheet:0,recovered:0,noSheet:0,failed:[]};
const queue=(await fs.readdir(`${root}/offers`)).filter(f=>f.endsWith('.json'));
const hosts=new Map();const sha=b=>createHash('sha256').update(b).digest('hex');
async function decode(url){
 const u=new URL(url);if(u.protocol!=='https:' || !/^jp\d+\.pa-server\.ru$/.test(u.hostname) || u.port || u.username)throw Error('invalid_sheet_host');
 for(let attempt=0;attempt<3;attempt++){
  const start=Math.max(Date.now(),(hosts.get(u.hostname)||0)+400);hosts.set(u.hostname,start);await new Promise(r=>setTimeout(r,Math.max(0,start-Date.now())));
  try{
   const r=await fetch(url,{signal:AbortSignal.timeout(25000),redirect:'error'});
   if(!r.ok)throw Object.assign(Error(`sheet_http_${r.status}`),{access:[401,403,429].includes(r.status)});
   const chunks=[];let size=0;for await(const b of r.body){size+=b.length;if(size>12000000)throw Error('sheet_too_large');chunks.push(b);}
   const decoded=await sharp(Buffer.concat(chunks),{limitInputPixels:40000000}).rotate().raw().toBuffer({resolveWithObject:true});
   if(decoded.info.width<100 || decoded.info.height<100)throw Error('sheet_too_small');
   const checksum=sha(decoded.data);
   return {id:checksum,url,objectKey:'',checksum,width:decoded.info.width,height:decoded.info.height,size,mimeType:'image/webp'};
  }catch(e){if(e.access || attempt===2)throw e;}
 }
}
async function worker(){while(queue.length){
 const name=queue.shift();const id=name.replace(/\.json$/,'');
 try{
  const record=JSON.parse(await fs.readFile(`${root}/raw/${name}`,'utf8'));
  const bytes=gunzipSync(await fs.readFile(`${root}/html/${id}.html.gz`));
  if(sha(bytes)!==record.evidenceSha256)throw Error('archive_checksum_mismatch');
  const e=parseProAuctionsDetailEvidence(bytes.toString('utf8'),record.sourceUrl);
  const offer=JSON.parse(await fs.readFile(`${root}/offers/${name}`,'utf8'));
  const patch={id:offer.id,sourceOfferId:id,sourceUrl:e.sourceUrl,sourcePrice:e.price.amountJpy,year:e.identity.year,lotNumber:e.identity.lotNumber,auctionDate:e.identity.auctionDate,evidenceSha256:record.evidenceSha256,sheets:[]};
  if(e.auctionSheetUrls.length){stats.withSheet++;for(const url of e.auctionSheetUrls)patch.sheets.push(await decode(url));stats.recovered++;}else stats.noSheet++;
  await fs.writeFile(`${out}/${name}`,JSON.stringify(patch));
 }catch(e){stats.failed.push({id,error:String(e)});}
 stats.scanned++;if(stats.scanned%100===0)console.log(JSON.stringify({...stats,failed:stats.failed.length}));
}}
await Promise.all(Array.from({length:8},()=>worker()));
await fs.writeFile(`${out}/summary.json`,JSON.stringify(stats,null,2));console.log(JSON.stringify(stats));
if(stats.failed.length)process.exitCode=1;
