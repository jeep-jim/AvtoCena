import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_SEARCH_OUTPUT || 'catalog-source-worldauto-search-endpoint-probe-v1.json';
const SOURCE_URL = 'https://worldauto.ge/en/search/car';
const BACKEND_ORIGIN = 'https://worldauto-backend-production.up.railway.app';
const ENDPOINT_PATH = '/search/sell/car/get';
const ENDPOINT_URL = `${BACKEND_ORIGIN}${ENDPOINT_PATH}`;
const USER_AGENT = 'AvtoCenaWorldAutoExactSearchProbe/1.0 (+single no-param read-only source qualification)';
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 1_500_000;
const HEADERS = { accept:'application/json,text/plain;q=0.8,*/*;q=0.5', 'accept-language':'en-US,en;q=0.9,ru;q=0.7', 'cache-control':'no-cache', pragma:'no-cache', 'user-agent':USER_AGENT };

const SAFE_KEY_RE = /(id|uuid|advert|offer|price|currency|year|mileage|odometer|engine|volume|displacement|power|horse|hp|kw|fuel|transmission|drive|mark|brand|make|model|generation|body|photo|image|picture|vin|condition|color|colour|city|created|updated|date)/i;
const SENSITIVE_KEY_RE = /(phone|email|seller|owner|contact|address|whatsapp|telegram|facebook|name$|user)/i;

function primitiveType(value){if(value===null)return'null';if(Array.isArray(value))return'array';return typeof value;}
function trimSample(value){if(value==null)return value;if(typeof value==='string')return value.slice(0,180);if(typeof value==='number'||typeof value==='boolean')return value;if(Array.isArray(value))return `[array:${value.length}]`;return '[object]';}

export function summarizeWorldAutoSearchPayload(payload){
  const topLevelType=primitiveType(payload);
  const topLevelKeys=payload&&typeof payload==='object'&&!Array.isArray(payload)?Object.keys(payload).slice(0,120):[];
  const arrays=[];
  function walk(node,path='',depth=0){
    if(depth>4||node==null)return;
    if(Array.isArray(node)){arrays.push({path:path||'$',length:node.length});if(node.length)walk(node[0],`${path}[0]`,depth+1);return;}
    if(typeof node==='object')for(const [key,value] of Object.entries(node).slice(0,160))walk(value,path?`${path}.${key}`:key,depth+1);
  }
  walk(payload);
  const candidateArrays=arrays.filter(row=>row.length>0).sort((a,b)=>b.length-a.length);
  let sampleItem=null;let samplePath='';
  function getPath(root,path){if(path==='$')return root;let cur=root;for(const part of path.replace(/^\$\.?/,'').split('.').filter(Boolean)){const m=part.match(/^([^[]+)\[0\]$/);if(m){cur=cur?.[m[1]]?.[0];}else if(part==='[0]'){cur=cur?.[0];}else cur=cur?.[part];}return cur;}
  for(const row of candidateArrays){const arr=getPath(payload,row.path);const item=Array.isArray(arr)?arr[0]:null;if(item&&typeof item==='object'&&!Array.isArray(item)){sampleItem=item;samplePath=row.path;break;}}
  if(!sampleItem&&Array.isArray(payload)&&payload[0]&&typeof payload[0]==='object'){sampleItem=payload[0];samplePath='$';}
  const sampleItemKeys=sampleItem?Object.keys(sampleItem).slice(0,200):[];
  const candidateVehicleFields=[];
  function collect(node,path='',depth=0){
    if(depth>4||node==null||candidateVehicleFields.length>=120)return;
    if(Array.isArray(node)){if(node.length&&typeof node[0]!=='object'&&SAFE_KEY_RE.test(path)&&!SENSITIVE_KEY_RE.test(path))candidateVehicleFields.push({path,type:'array',sample:`[array:${node.length}]`});return;}
    if(typeof node!=='object')return;
    for(const [key,value] of Object.entries(node)){
      const p=path?`${path}.${key}`:key;
      if(SENSITIVE_KEY_RE.test(key)||SENSITIVE_KEY_RE.test(p))continue;
      if(value==null||typeof value!=='object'){
        if(SAFE_KEY_RE.test(key)||SAFE_KEY_RE.test(p))candidateVehicleFields.push({path:p,type:primitiveType(value),sample:trimSample(value)});
      }else if(Array.isArray(value)){
        if(SAFE_KEY_RE.test(key)||SAFE_KEY_RE.test(p))candidateVehicleFields.push({path:p,type:'array',sample:`[array:${value.length}]`});
        if(value.length&&typeof value[0]==='object')collect(value[0],`${p}[0]`,depth+1);
      }else collect(value,p,depth+1);
      if(candidateVehicleFields.length>=120)break;
    }
  }
  if(sampleItem)collect(sampleItem,'item');
  return {topLevelType,topLevelKeys,arrays:candidateArrays.slice(0,30),sampleItemPath:samplePath,sampleItemKeys,candidateVehicleFields};
}

async function readLimited(response){const reader=response.body?.getReader?.();if(!reader){const body=await response.text();return{body:body.slice(0,MAX_BODY_BYTES),truncated:body.length>MAX_BODY_BYTES};}const chunks=[];let total=0,truncated=false;while(true){const{done,value}=await reader.read();if(done)break;if(!value)continue;const remain=MAX_BODY_BYTES-total;if(remain<=0){truncated=true;break;}const slice=value.byteLength>remain?value.slice(0,remain):value;chunks.push(Buffer.from(slice));total+=slice.byteLength;if(value.byteLength>remain){truncated=true;break;}}return{body:Buffer.concat(chunks).toString('utf8'),truncated};}
async function fetchBounded(url,headers=HEADERS){const r=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS)});const{body,truncated}=await readLimited(r);return{status:r.status,ok:r.ok,finalUrl:r.url||url,contentType:r.headers.get('content-type')||'',body,truncated,bodyHashSha256:crypto.createHash('sha256').update(body).digest('hex')};}

export async function runWorldAutoSearchEndpointProbe(){
  const safety={productionWrites:false,classificationMutations:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,rawBodiesStored:false,guessedRoutes:false,paginationRequests:0,detailRequests:0,apiRequests:0};
  const sourceRobots=await fetchBounded('https://worldauto.ge/robots.txt',{...HEADERS,accept:'text/plain,*/*;q=0.5'});
  const sourcePolicy=sourceRobots.ok?evaluateRobots(sourceRobots.body,SOURCE_URL,USER_AGENT):{allowed:true,matchedRule:null,applicableGroupCount:0};
  if(!sourcePolicy.allowed){const p={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_exact_search_endpoint_probe_no_write',sourceUrl:SOURCE_URL,backendOrigin:BACKEND_ORIGIN,endpointPath:ENDPOINT_PATH,...safety,requestCount:1,sourceRobots:{status:sourceRobots.status,policy:sourcePolicy},backendRobots:null,response:null,decisionSignal:'source_robots_disallowed'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(p,null,2));return p;}
  const backendRobots=await fetchBounded(`${BACKEND_ORIGIN}/robots.txt`,{...HEADERS,accept:'text/plain,*/*;q=0.5'});
  const backendPolicy=backendRobots.ok?evaluateRobots(backendRobots.body,ENDPOINT_URL,USER_AGENT):{allowed:true,matchedRule:null,applicableGroupCount:0,robotsUnavailable:true};
  if(backendRobots.ok&&!backendPolicy.allowed){const p={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_exact_search_endpoint_probe_no_write',sourceUrl:SOURCE_URL,backendOrigin:BACKEND_ORIGIN,endpointPath:ENDPOINT_PATH,...safety,requestCount:2,sourceRobots:{status:sourceRobots.status,policy:sourcePolicy},backendRobots:{status:backendRobots.status,policy:backendPolicy},response:null,decisionSignal:'backend_robots_disallowed'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(p,null,2));return p;}
  const response=await fetchBounded(ENDPOINT_URL);
  let parsed=null,parseError='';if(response.body){try{parsed=JSON.parse(response.body);}catch(e){parseError=String(e?.message||e).slice(0,220);}}
  const summary=parsed!==null?summarizeWorldAutoSearchPayload(parsed):null;
  const payload={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_exact_search_endpoint_probe_no_write',sourceUrl:SOURCE_URL,backendOrigin:BACKEND_ORIGIN,endpointPath:ENDPOINT_PATH,endpointUrl:ENDPOINT_URL,...safety,apiRequests:1,requestCount:3,sourceRobots:{status:sourceRobots.status,bodyHashSha256:sourceRobots.bodyHashSha256,policy:sourcePolicy},backendRobots:{status:backendRobots.status,bodyHashSha256:backendRobots.bodyHashSha256,policy:backendPolicy},response:{status:response.status,finalUrl:response.finalUrl,contentType:response.contentType,truncated:response.truncated,bodyHashSha256:response.bodyHashSha256,bytes:Buffer.byteLength(response.body),jsonParsed:parsed!==null,parseError,summary},decisionSignal:response.ok&&parsed!==null?'source_declared_search_endpoint_json_received':response.ok?'source_declared_search_endpoint_non_json':`source_declared_search_endpoint_http_${response.status}`,next:response.ok&&parsed!==null?'Review offer-bound field coverage and identify a source-declared detail identifier/route from this response before any detail request.':'Keep WorldAuto research_pending; do not paginate or guess parameters.'};
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(payload,null,2));console.log(JSON.stringify({output:OUTPUT_PATH,status:response.status,jsonParsed:parsed!==null,summary,decisionSignal:payload.decisionSignal},null,2));return payload;
}
const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:'';if(entry===import.meta.url)runWorldAutoSearchEndpointProbe().catch(e=>{console.error(e);process.exitCode=1;});
