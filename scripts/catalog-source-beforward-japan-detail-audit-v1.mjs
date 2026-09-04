import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT = process.env.CATALOG_SOURCE_BEFORWARD_DETAIL_OUTPUT || 'catalog-source-beforward-japan-detail-audit-v1.json';
const TIMEOUT = Math.max(3000, Math.min(30000, Number(process.env.CATALOG_SOURCE_BEFORWARD_DETAIL_TIMEOUT_MS || 15000)));
const USER_AGENT = 'AvtoCenaBeforwardDetailAudit/1.0 (+read-only source qualification)';
const HEADERS = { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.9', 'user-agent': USER_AGENT, 'cache-control': 'no-cache', pragma: 'no-cache' };

// These URLs and list-side values were emitted by BE FORWARD's own public
// /stocklist on 2026-09-04. They are fixed evidence samples, not guessed routes.
export const SAMPLES = [
  { refNo: 'CE621935', url: 'https://www.beforward.jp/nissan/march/ce621935/id/16508049/', priceUsd: 2120, year: '2017/7', mileageKm: 81267, engineCc: 1190, fuel: 'Petrol', location: 'Nagoya' },
  { refNo: 'CE612705', url: 'https://www.beforward.jp/toyota/vitz/ce612705/id/16508135/', priceUsd: 2320, year: '2012/7', mileageKm: 123609, engineCc: 1320, fuel: 'Petrol', location: 'Yokohama' },
  { refNo: 'CE612708', url: 'https://www.beforward.jp/honda/fit/ce612708/id/16508165/', priceUsd: 2390, year: '2014/3', mileageKm: 144925, engineCc: 1310, fuel: 'Petrol', location: 'Yokohama' },
  { refNo: 'CE621869', url: 'https://www.beforward.jp/toyota/crown/ce621869/id/16507885/', priceUsd: 2590, year: '2009/9', mileageKm: 102411, engineCc: 2490, fuel: 'Petrol', location: 'Nagoya' },
];

function clean(value, limit = 1000) { return String(value ?? '').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,limit); }
function visible(html) { return clean(html, 250000); }
function capture(text, re) { const m=String(text||'').match(re); return m ? clean(m[1],200) : null; }
function num(value) { if (!value) return null; const n=Number(String(value).replace(/,/g,'')); return Number.isFinite(n) ? n : null; }
function parity(a,b) { return a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase(); }

export function parseDetailEvidence(html) {
  const text = visible(html);
  const price = capture(text, /(?:Vehicle Price|Price)\s*:?\s*\$\s*([\d,]+(?:\.\d+)?)/i) || capture(text,/\$\s*([\d,]+(?:\.\d+)?)/i);
  const power = [...text.matchAll(/\b(?:Horsepower|Engine Power|Maximum Power|Max Power|Power Output)\s*[:：-]?\s*([\d,.]+)\s*(HP|PS|kW)\b/gi)].map(m=>({value:num(m[1]),unit:m[2].toUpperCase()}));
  const images = [...new Set([...String(html||'').matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:jpe?g|webp|png)(?:\?[^"'<>\\\s]*)?/gi)].map(m=>m[0].replace(/\\\//g,'/')).filter(u=>/beforward\.jp/i.test(u) && !/(?:logo|icon|sprite|banner|flag|avatar|qr|placeholder)/i.test(u)))];
  return {
    title: capture(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    refNo: capture(text, /Ref\s+No\.\s*([A-Z0-9-]{4,})/i),
    priceUsd: num(price),
    year: capture(text, /\bYear\s+((?:19|20)\d{2}(?:\/\d{1,2})?)/i),
    mileageKm: num(capture(text, /\bMileage\s+([\d,]+)\s*km\b/i)),
    engineCc: num(capture(text, /\bEngine\s+([\d,]+)\s*cc\b/i)),
    fuel: capture(text, /\bFuel\s+(.{1,40}?)(?=\s+(?:Seats|Engine code|Color|Drive|Doors|Auction grade|Price|Model code|Steering)\b)/i),
    body: capture(text, /\b(?:Body Type|Body Style)\s+(.{1,60}?)(?=\s+(?:Fuel|Engine|Mileage|Year|Drive|Doors|Seats|Color|Transmission|Trans\.)\b)/i),
    power,
    imageCount: images.length,
    imageSample: images.slice(0,12),
    diagnosticSnippet: text.slice(0,500),
  };
}

async function timed(url, options={}) { const c=new AbortController(); const t=setTimeout(()=>c.abort(),TIMEOUT); try{return await fetch(url,{...options,signal:c.signal});} finally{clearTimeout(t);} }
let robotsCache;
async function robotsFor() { if (robotsCache) return robotsCache; try { const r=await timed('https://www.beforward.jp/robots.txt',{headers:HEADERS,redirect:'follow'}); robotsCache={status:r.status,text:r.ok?(await r.text()).slice(0,500000):''}; } catch(e) { robotsCache={status:null,text:'',error:String(e?.message||e)}; } return robotsCache; }
async function request(url) {
  const robots=await robotsFor();
  const policy=robots.text?evaluateRobots(robots.text,url,USER_AGENT):{allowed:true,matchedRule:null};
  if(!policy.allowed)return{kind:'robots_disallowed',status:null,robotsStatus:robots.status,matchedRule:policy.matchedRule};
  try{
    const r=await timed(url,{headers:HEADERS,redirect:'manual'});
    if([301,302,303,307,308].includes(r.status))return{kind:'redirect_not_followed',status:r.status,location:r.headers.get('location'),robotsStatus:robots.status};
    const bytes=Buffer.from(await r.arrayBuffer()); const body=bytes.subarray(0,1600000).toString('utf8'); const evidence=parseDetailEvidence(body);
    const challenge=/captcha|cloudflare|verify (?:that )?you are human|access denied|request blocked|robot check|security check|challenge/i.test(`${evidence.title} ${evidence.diagnosticSnippet}`);
    return{kind:challenge?'challenge':r.ok?'reachable':'http_error',status:r.status,contentType:r.headers.get('content-type')||'',bytes:bytes.length,hash:crypto.createHash('sha256').update(bytes).digest('hex'),robotsStatus:robots.status,evidence};
  }catch(e){return{kind:'network_error',status:null,robotsStatus:robots.status,error:String(e?.message||e)};}
}

function matrix(sample,e) {
  if(!e)return{exactReady:false,deficits:['detail_unavailable']};
  const imageBound=e.imageSample.filter(u=>u.toLowerCase().includes(sample.refNo.toLowerCase()) || /\/id\/\d+/.test(u));
  const fields={
    identity:e.refNo?.toUpperCase()===sample.refNo?'exact':'missing_or_conflict',
    price:parity(e.priceUsd,sample.priceUsd)?'exact':'missing_or_conflict', year:parity(e.year,sample.year)?'exact':'missing_or_conflict', mileage:parity(e.mileageKm,sample.mileageKm)?'exact':'missing_or_conflict', engineCc:parity(e.engineCc,sample.engineCc)?'exact':'missing_or_conflict', fuel:e.fuel?'exact':'missing', body:e.body?'exact':'missing', power:e.power?.length===1?'exact':'missing_or_ambiguous', gallery:imageBound.length>=5?'exact':'unproven'
  };
  const deficits=Object.entries(fields).filter(([,v])=>v!=='exact').map(([k])=>k); return{fields,exactReady:deficits.length===0,deficits,listingBoundImageCount:imageBound.length};
}

export async function runDetailAudit(){
  const results=[];
  for(const sample of SAMPLES){const first=await request(sample.url); const second=await request(sample.url); results.push({sample,first,second,repeatStable:first.kind==='reachable'&&second.kind==='reachable'&&first.hash===second.hash,fieldMatrix:matrix(sample,first.evidence)});}
  const deficits={}; for(const r of results)for(const d of r.fieldMatrix.deficits)deficits[d]=(deficits[d]||0)+1;
  const payload={version:1,generatedAt:new Date().toISOString(),mode:'beforward_japan_fixed_detail_audit_no_write',productionWrites:false,classificationMutations:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,rawBodiesStored:false,guessedRoutes:false,sourceId:'beforward_japan_candidate',sourcePublishAllowed:false,sampleCount:SAMPLES.length,results,sourceVerdict:{classificationDecision:'deferred',stableReachableCount:results.filter(r=>r.repeatStable).length,exactReadyCount:results.filter(r=>r.fieldMatrix.exactReady).length,deficitCounts:deficits,reason:'fixed source-declared detail samples audited; manual classification required'}};
  await fs.writeFile(OUTPUT,JSON.stringify(payload,null,2)); console.log(JSON.stringify({output:OUTPUT,...payload.sourceVerdict},null,2)); return payload;
}
const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:''; if(entry===import.meta.url)runDetailAudit().catch(e=>{console.error(e);process.exitCode=1;});
