import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_DEFICIT_RESOLUTION_OUTPUT || 'catalog-source-deficit-resolution-v1.json';
const TIMEOUT_MS = Math.max(3000, Math.min(45000, Number(process.env.CATALOG_SOURCE_DEFICIT_RESOLUTION_TIMEOUT_MS || 15000)));
const MAX_BODY_BYTES = Math.max(200000, Math.min(2000000, Number(process.env.CATALOG_SOURCE_DEFICIT_RESOLUTION_MAX_BODY_BYTES || 1600000)));
const USER_AGENT = 'AvtoCenaDeficitResolution/1.0 (+read-only source qualification)';

const SAMPLES = [
  { market:'korea', sourceId:'bobaedream_korea_candidate', offerId:'2260063', url:'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2260063&gubun=K', galleryKind:'boba' },
  { market:'korea', sourceId:'bobaedream_korea_candidate', offerId:'2262188', url:'https://www.bobaedream.co.kr/mycar/mycar_view.php?no=2262188&gubun=K', galleryKind:'boba' },
  { market:'uae', sourceId:'carswitch_uae_candidate', offerId:'864601', url:'https://carswitch.com/abudhabi/used-car/chevrolet/captiva/2025/864601', engineLiter:1.5 },
  { market:'uae', sourceId:'carswitch_uae_candidate', offerId:'857416', url:'https://carswitch.com/abudhabi/used-car/dodge/durango/2013/857416', engineLiter:5.7 },
  { market:'uae', sourceId:'cars24_uae_candidate', offerId:'9714841569', url:'https://www.cars24.ae/buy-used-chevrolet-groove-2023-cars-dubai-9714841569/', engineLiter:1.5, expectedPriceAed:31499 },
  { market:'uae', sourceId:'cars24_uae_candidate', offerId:'9714841918', url:'https://www.cars24.ae/buy-used-ford-territory-2024-cars-dubai-9714841918/', engineLiter:1.8, expectedPriceAed:64999 },
  { market:'uae', sourceId:'dubicars_uae_exact', offerId:'740206', url:'https://www.dubicars.com/2019-hyundai-veloster-740206.html', galleryKind:'dubicars' },
  { market:'uae', sourceId:'dubicars_uae_exact', offerId:'979972', url:'https://www.dubicars.com/2023-bmw-ix1-979972.html', galleryKind:'dubicars' },
];

const HEADERS = { accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5', 'accept-language':'en-US,en;q=0.9,ko;q=0.7', 'cache-control':'no-cache', pragma:'no-cache', 'user-agent':USER_AGENT };

function decode(v){return String(v??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function clean(v,limit=500){return decode(String(v??'').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);}
function visibleText(html){return clean(String(html||'').replace(/<\/(?:div|p|li|tr|td|th|section|h[1-6])>/gi,'\n').replace(/<br\s*\/?>/gi,'\n'),200000);}
function titleOf(html){return clean(String(html||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',300);}
function canonicalOf(html,base){const raw=String(html||'').match(/<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1]||String(html||'').match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["'][^"']*canonical[^"']*["']/i)?.[1];try{return raw?new URL(decode(raw),base).toString():null}catch{return null}}
function uniq(a){return [...new Set(a.filter(Boolean))];}

export function extractExplicitUnitEvidence(html, expectedLiter=null){
  const text=visibleText(html);
  const all=[];
  for(const m of text.matchAll(/\b(\d{1,4}(?:\.\d+)?)\s*(L|lit(?:er|re)s?|cc|cm3|cm³|BHP|HP|PS|kW)\b/gi)){
    const idx=m.index??0; all.push({value:Number(m[1]),unit:m[2],context:text.slice(Math.max(0,idx-120),Math.min(text.length,idx+220)).trim()});
  }
  const engine=expectedLiter==null?[]:all.filter(x=>/^(?:L|lit)/i.test(x.unit)&&Math.abs(x.value-expectedLiter)<0.0001);
  const cc=all.filter(x=>/^(?:cc|cm)/i.test(x.unit));
  const power=all.filter(x=>/^(?:BHP|HP|PS|kW)$/i.test(x.unit));
  return {expectedLiter,engineLiterMatches:engine.slice(0,20),ccEvidence:cc.slice(0,30),powerEvidence:power.slice(0,30)};
}

export function extractExpectedOfferPrice(html, expectedPriceAed=null){
  if(expectedPriceAed==null)return null;
  const text=visibleText(html);
  const formatted=expectedPriceAed.toLocaleString('en-US');
  const patterns=[new RegExp(`AED\\s*${formatted.replace(',','[,]?')}(?!\\d)`,'gi'),new RegExp(`${formatted.replace(',','[,]?')}\\s*AED\\b`,'gi')];
  const hits=[];
  for(const re of patterns)for(const m of text.matchAll(re)){const idx=m.index??0;hits.push({match:m[0],context:text.slice(Math.max(0,idx-160),Math.min(text.length,idx+260)).trim()});}
  const raw=String(html||'');
  const offerBlock=[];
  let from=0;
  while(true){const idx=raw.indexOf(String(expectedPriceAed),from);if(idx<0)break;const snippet=decode(raw.slice(Math.max(0,idx-500),Math.min(raw.length,idx+700))).replace(/\s+/g,' ').trim();if(/appointmentId|carDetails|price|cash|AED/i.test(snippet))offerBlock.push(snippet.slice(0,900));from=idx+String(expectedPriceAed).length;}
  return {expectedPriceAed,visibleHits:hits.slice(0,20),embeddedContexts:uniq(offerBlock).slice(0,20)};
}

function bobaGallery(html,offerId){
  const src=decode(String(html||'')); const rows=[];
  for(const m of src.matchAll(/gallery-data/gi)){const idx=m.index??0;const frag=src.slice(Math.max(0,idx-2500),Math.min(src.length,idx+25000));if(!frag.includes(String(offerId)))continue;const urls=[...frag.matchAll(/https?:\\?\/\\?\/file\d+\.bobaedream\.co\.kr\/direct\/[^"'\s<>]+?\.jpe?g/gi)].map(x=>x[0].replace(/\\\//g,'/'));const parsed=urls.map(u=>{const mm=u.match(/\/(Eh\d+)_(\d+)(?:_s\d+)?\.jpe?g/i);return mm?{series:mm[1],index:Number(mm[2]),url:u}:null}).filter(Boolean);const groups={};for(const x of parsed)(groups[x.series]??=new Set()).add(x.index);for(const [series,set] of Object.entries(groups))rows.push({series,uniqueIndexes:[...set].sort((a,b)=>a-b),uniqueUnderlyingCount:set.size,offerBound:true});}
  return rows.sort((a,b)=>b.uniqueUnderlyingCount-a.uniqueUnderlyingCount).slice(0,5);
}
function dubicarsGallery(html,offerId){
  const src=decode(String(html||''));const rows=[];
  for(const m of src.matchAll(/(?:car-images-slider|slider-actions)/gi)){const idx=m.index??0;const frag=src.slice(Math.max(0,idx-5000),Math.min(src.length,idx+45000));if(!frag.includes(String(offerId)))continue;const uuids=uniq([...frag.matchAll(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpe?g|png|webp)/gi)].map(x=>x[1].toLowerCase()));if(uuids.length>=3)rows.push({uniqueUnderlyingCount:uuids.length,underlyingIds:uuids.slice(0,30),offerBound:true});}
  return rows.sort((a,b)=>b.uniqueUnderlyingCount-a.uniqueUnderlyingCount).slice(0,5);
}
export function extractGalleryProof(html,offerId,kind){return kind==='boba'?bobaGallery(html,offerId):kind==='dubicars'?dubicarsGallery(html,offerId):[];}

async function fetchTimed(url,options={}){const c=new AbortController();const t=setTimeout(()=>c.abort(),TIMEOUT_MS);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(t)}}
async function readLimited(r){const reader=r.body?.getReader?.();if(!reader)return {body:await r.text(),truncated:false};const chunks=[];let total=0,truncated=false;while(true){const {done,value}=await reader.read();if(done)break;if(!value)continue;const remain=MAX_BODY_BYTES-total;if(remain<=0){truncated=true;break}const slice=value.byteLength>remain?value.slice(0,remain):value;chunks.push(Buffer.from(slice));total+=slice.byteLength;if(value.byteLength>remain){truncated=true;break}}return {body:Buffer.concat(chunks).toString('utf8'),truncated};}
const robotsCache=new Map();async function robotsFor(url){const origin=new URL(url).origin,ru=`${origin}/robots.txt`;if(robotsCache.has(ru))return robotsCache.get(ru);try{const r=await fetchTimed(ru,{headers:HEADERS,redirect:'manual'});const text=r.ok?(await readLimited(r)).body:'';const out={status:r.status,text};robotsCache.set(ru,out);return out}catch(e){const out={status:null,text:'',error:String(e?.message||e)};robotsCache.set(ru,out);return out}}
async function fetchOne(s){const rob=await robotsFor(s.url);const policy=evaluateRobots(rob.text,s.url,USER_AGENT);if(!policy.allowed)return {kind:'robots_disallowed',matchedRule:policy.matchedRule};let r;try{r=await fetchTimed(s.url,{headers:HEADERS,redirect:'manual'})}catch(e){return {kind:'network_error',error:String(e?.message||e)}}if(r.status>=300&&r.status<400)return {kind:'redirect_not_followed',status:r.status,location:r.headers.get('location')};const {body,truncated}=await readLimited(r);const summary={status:r.status,truncated,title:titleOf(body),canonical:canonicalOf(body,s.url),bodyHashSha256:crypto.createHash('sha256').update(body).digest('hex'),unitEvidence:extractExplicitUnitEvidence(body,s.engineLiter??null),priceEvidence:extractExpectedOfferPrice(body,s.expectedPriceAed??null),galleryProof:extractGalleryProof(body,s.offerId,s.galleryKind)};summary.evidenceFingerprint=crypto.createHash('sha256').update(JSON.stringify({title:summary.title,canonical:summary.canonical,unitEvidence:summary.unitEvidence,priceEvidence:summary.priceEvidence,galleryProof:summary.galleryProof})).digest('hex');return {kind:r.ok?'reachable':'http_error',summary};}
async function runSample(s){const first=await fetchOne(s),second=await fetchOne(s);return {...s,first,second,repeat:{sameKind:first.kind===second.kind,sameBodyHash:Boolean(first.summary?.bodyHashSha256&&first.summary.bodyHashSha256===second.summary?.bodyHashSha256),sameEvidenceFingerprint:Boolean(first.summary?.evidenceFingerprint&&first.summary.evidenceFingerprint===second.summary?.evidenceFingerprint)}};}
export async function runResolution(){const results=[];for(const s of SAMPLES)results.push(await runSample(s));const payload={version:1,generatedAt:new Date().toISOString(),mode:'source_deficit_resolution_evidence_no_write',productionWrites:false,classificationMutations:false,publishAllowedMutations:false,rawBodiesStored:false,sampleCount:SAMPLES.length,results,next:'use only repeated offer-bound evidence to close parser/gallery deficits; missing exact cc or power remains a source deficit'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(payload,null,2));console.log(JSON.stringify({output:OUTPUT_PATH,sampleCount:payload.sampleCount,generatedAt:payload.generatedAt},null,2));return payload;}
const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:'';if(entry===import.meta.url)runResolution().catch(e=>{console.error(e);process.exitCode=1});
