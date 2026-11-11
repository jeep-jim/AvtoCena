import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';
import {
  detectWorldAutoPublicAccessPolicy,
  extractWorldAutoDeclaredRoutes,
} from './catalog-source-worldauto-access-route-probe-v1.mjs';

const SOURCE_ID = 'worldauto_georgia_candidate';
const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_BASEURL_OUTPUT || 'catalog-source-worldauto-baseurl-config-probe-v1.json';
const USER_AGENT = 'AvtoCenaWorldAutoBaseUrlProbe/1.0 (+bounded read-only declared-config qualification)';
const TARGET_MODULE_ID = '21337';
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 1_200_000;
const HEADERS = {accept:'text/html,application/javascript,text/javascript,text/plain;q=0.8,*/*;q=0.5','accept-language':'en-US,en;q=0.9,ru;q=0.7','cache-control':'no-cache',pragma:'no-cache','user-agent':USER_AGENT};

function uniq(values, limit=30){const out=[];const seen=new Set();for(const v of values){if(!v||seen.has(v))continue;seen.add(v);out.push(v);if(out.length>=limit)break;}return out;}
function scrub(value){return String(value||'').replace(/([?&](?:token|auth|key|signature|session|cookie|jwt|access_token)=)[^&"'`\s,)]+/gi,'$1[redacted]').replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi,'Bearer [redacted]').replace(/\s+/g,' ').slice(0,5000);}

export function extractWorldAutoBaseUrlConfig(jsText,moduleId=TARGET_MODULE_ID){
  const text=String(jsText||'');
  const re=new RegExp(`(?:^|[,({])${moduleId}:\\s*(?:\\(|function\\b)`);
  const m=re.exec(text);
  if(!m)return{moduleFound:false,moduleIndex:-1,baseUrlValues:[],urls:[],context:''};
  const start=m.index;
  const source=text.slice(start,Math.min(text.length,start+20000));
  const baseUrlValues=[];
  for(const x of source.matchAll(/baseUrl\s*[:=]\s*["'`]([^"'`]{1,500})["'`]/gi))baseUrlValues.push(x[1]);
  for(const x of source.matchAll(/baseURL\s*[:=]\s*["'`]([^"'`]{1,500})["'`]/gi))baseUrlValues.push(x[1]);
  const urls=[];for(const x of source.matchAll(/https?:\/\/[^"'`\s,)]+/gi))urls.push(x[0]);
  return{moduleFound:true,moduleIndex:start,baseUrlValues:uniq(baseUrlValues),urls:uniq(urls),context:scrub(text.slice(Math.max(0,start-250),Math.min(text.length,start+6000)))};
}

async function readLimited(response){const reader=response.body?.getReader?.();if(!reader){const body=await response.text();return{body:body.slice(0,MAX_BODY_BYTES),truncated:body.length>MAX_BODY_BYTES};}const chunks=[];let total=0,truncated=false;while(true){const{done,value}=await reader.read();if(done)break;if(!value)continue;const remaining=MAX_BODY_BYTES-total;if(remaining<=0){truncated=true;break;}const slice=value.byteLength>remaining?value.slice(0,remaining):value;chunks.push(Buffer.from(slice));total+=slice.byteLength;if(value.byteLength>remaining){truncated=true;break;}}return{body:Buffer.concat(chunks).toString('utf8'),truncated};}
async function fetchBounded(url){const response=await fetch(url,{headers:HEADERS,redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS)});const{body,truncated}=await readLimited(response);return{status:response.status,ok:response.ok,finalUrl:response.url||url,body,truncated,bodyHashSha256:crypto.createHash('sha256').update(body).digest('hex')};}
async function loadCandidate(){const registry=JSON.parse(await fs.readFile(REGISTRY_PATH,'utf8'));const candidate=registry.candidates?.find(row=>row.sourceId===SOURCE_ID);if(!candidate?.url)throw new Error(`worldauto_registry_candidate_missing:${SOURCE_ID}`);return candidate;}

export async function runWorldAutoBaseUrlConfigProbe(){
  const candidate=await loadCandidate();const sourceUrl=candidate.url;const origin=new URL(sourceUrl).origin;
  const safety={productionWrites:false,classificationMutations:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,rawBodiesStored:false,guessedRoutes:false,detailRequests:0,paginationRequests:0,apiRequests:0};
  const robots=await fetchBounded(`${origin}/robots.txt`);const robotsPolicy=robots.ok?evaluateRobots(robots.body,sourceUrl,USER_AGENT):{allowed:true,matchedRule:null,applicableGroupCount:0};
  if(!robotsPolicy.allowed){const p={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_baseurl_config_probe_no_write',sourceId:SOURCE_ID,sourceUrl,...safety,requestCount:1,scriptRequests:0,robots:{status:robots.status,policy:robotsPolicy},page:null,scripts:[],config:null,decisionSignal:'robots_disallowed'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(p,null,2));return p;}
  const page=await fetchBounded(sourceUrl);const policy=detectWorldAutoPublicAccessPolicy(page.body);const declared=extractWorldAutoDeclaredRoutes(page.body,page.finalUrl||sourceUrl,sourceUrl);
  if(policy.explicitRestrictionObserved){const p={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_baseurl_config_probe_no_write',sourceId:SOURCE_ID,sourceUrl,...safety,requestCount:2,scriptRequests:0,robots:{status:robots.status,policy:robotsPolicy},page:{status:page.status},scripts:[],config:null,decisionSignal:'public_terms_block_automated_collection'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(p,null,2));return p;}
  const selected=declared.sameOriginScriptUrls.filter(url=>/\/main-/i.test(new URL(url).pathname)).slice(0,7);const scripts=[];let config=null;
  for(const url of selected){const r=await fetchBounded(url);const s=r.ok?extractWorldAutoBaseUrlConfig(r.body):{moduleFound:false};scripts.push({url,status:r.status,truncated:r.truncated,bodyHashSha256:r.bodyHashSha256,moduleFound:!!s.moduleFound});if(s.moduleFound){config={scriptUrl:url,...s};break;}}
  const payload={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_baseurl_config_probe_no_write',sourceId:SOURCE_ID,sourceUrl,...safety,requestCount:2+scripts.length,scriptRequests:scripts.length,robots:{status:robots.status,bodyHashSha256:robots.bodyHashSha256,policy:robotsPolicy},page:{status:page.status,bodyHashSha256:page.bodyHashSha256},scripts,config,decisionSignal:config?.baseUrlValues?.length?'source_declared_baseurl_found':config?.moduleFound?'config_module_found_without_literal_baseurl':'config_module_not_found',next:config?.baseUrlValues?.length?'Validate GET <baseUrl>/search/sell/car/get once with no invented params; no pagination.':'Do not call the search route until base transport is proven.'};
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(payload,null,2));console.log(JSON.stringify({output:OUTPUT_PATH,requestCount:payload.requestCount,config:config?{scriptUrl:config.scriptUrl,baseUrlValues:config.baseUrlValues,urls:config.urls}:null,decisionSignal:payload.decisionSignal},null,2));return payload;
}
const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:'';if(entry===import.meta.url)runWorldAutoBaseUrlConfigProbe().catch(e=>{console.error(e);process.exitCode=1;});
