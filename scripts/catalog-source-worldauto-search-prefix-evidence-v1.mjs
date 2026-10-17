import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { evaluateRobots } from './catalog-source-access-probe-v1.mjs';

const OUTPUT_PATH = process.env.CATALOG_SOURCE_WORLDAUTO_PREFIX_OUTPUT || 'catalog-source-worldauto-search-prefix-evidence-v1.json';
const SOURCE_URL = 'https://worldauto.ge/en/search/car';
const BACKEND_ORIGIN = 'https://worldauto-backend-production.up.railway.app';
const ENDPOINT_PATH = '/search/sell/car/get';
const ENDPOINT_URL = `${BACKEND_ORIGIN}${ENDPOINT_PATH}`;
const USER_AGENT = 'AvtoCenaWorldAutoSearchPrefixProbe/1.0 (+single read-only source-declared search evidence)';
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 1_500_000;
const HEADERS = {accept:'application/json,text/plain;q=0.8,*/*;q=0.5','accept-language':'en-US,en;q=0.9,ru;q=0.7','cache-control':'no-cache',pragma:'no-cache','user-agent':USER_AGENT};
const SAFE_KEY_RE=/(id|uuid|advert|offer|price|currency|year|mileage|odometer|engine|volume|displacement|power|horse|hp|kw|fuel|transmission|drive|mark|brand|make|model|generation|body|photo|image|picture|vin|condition|color|colour|city|created|updated|date)/i;
const SENSITIVE_KEY_RE=/(phone|email|seller|owner|contact|address|whatsapp|telegram|facebook|name$|user)/i;

function trimSample(value){if(value==null)return value;if(typeof value==='string')return value.slice(0,160);if(typeof value==='number'||typeof value==='boolean')return value;if(Array.isArray(value))return `[array:${value.length}]`;return '[object]';}
function primitiveType(value){if(value===null)return'null';if(Array.isArray(value))return'array';return typeof value;}

export function extractFirstArrayObject(jsonPrefix){
  const text=String(jsonPrefix||'');
  let inString=false,escape=false;
  for(let i=0;i<text.length-1;i++){
    const ch=text[i];
    if(inString){if(escape){escape=false;continue;}if(ch==='\\'){escape=true;continue;}if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;continue;}
    if(ch!=='[')continue;
    let j=i+1;while(j<text.length&&/\s/.test(text[j]))j++;
    if(text[j]!=='{')continue;
    const start=j;let depth=0,str=false,esc=false;
    for(;j<text.length;j++){
      const c=text[j];
      if(str){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c==='"')str=false;continue;}
      if(c==='"'){str=true;continue;}
      if(c==='{')depth++;
      else if(c==='}'){depth--;if(depth===0){const raw=text.slice(start,j+1);try{return{found:true,arrayOffset:i,objectOffset:start,rawLength:raw.length,value:JSON.parse(raw)};}catch{return{found:false,arrayOffset:i,objectOffset:start,rawLength:raw.length,value:null};}}}
    }
  }
  return{found:false,arrayOffset:-1,objectOffset:-1,rawLength:0,value:null};
}

export function summarizeRecoveredWorldAutoItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return{keys:[],candidateVehicleFields:[]};
  const keys=Object.keys(item).slice(0,220);
  const candidateVehicleFields=[];
  function collect(node,path='item',depth=0){
    if(depth>4||!node||typeof node!=='object'||candidateVehicleFields.length>=140)return;
    for(const [key,value] of Object.entries(node)){
      const p=`${path}.${key}`;
      if(SENSITIVE_KEY_RE.test(key)||SENSITIVE_KEY_RE.test(p))continue;
      if(value===null||typeof value!=='object'){
        if(SAFE_KEY_RE.test(key)||SAFE_KEY_RE.test(p))candidateVehicleFields.push({path:p,type:primitiveType(value),sample:trimSample(value)});
      }else if(Array.isArray(value)){
        if(SAFE_KEY_RE.test(key)||SAFE_KEY_RE.test(p))candidateVehicleFields.push({path:p,type:'array',sample:`[array:${value.length}]`});
        if(value[0]&&typeof value[0]==='object')collect(value[0],`${p}[0]`,depth+1);
      }else collect(value,p,depth+1);
      if(candidateVehicleFields.length>=140)break;
    }
  }
  collect(item);
  return{keys,candidateVehicleFields};
}

async function readLimited(response){const reader=response.body?.getReader?.();if(!reader){const body=await response.text();return{body:body.slice(0,MAX_BODY_BYTES),truncated:body.length>MAX_BODY_BYTES};}const chunks=[];let total=0,truncated=false;while(true){const{done,value}=await reader.read();if(done)break;if(!value)continue;const remain=MAX_BODY_BYTES-total;if(remain<=0){truncated=true;break;}const slice=value.byteLength>remain?value.slice(0,remain):value;chunks.push(Buffer.from(slice));total+=slice.byteLength;if(value.byteLength>remain){truncated=true;break;}}return{body:Buffer.concat(chunks).toString('utf8'),truncated};}
async function fetchBounded(url,headers=HEADERS){const r=await fetch(url,{headers,redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS)});const{body,truncated}=await readLimited(r);return{status:r.status,ok:r.ok,finalUrl:r.url||url,contentType:r.headers.get('content-type')||'',body,truncated,bodyHashSha256:crypto.createHash('sha256').update(body).digest('hex')};}

export async function runWorldAutoSearchPrefixEvidence(){
  const safety={productionWrites:false,classificationMutations:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,rawBodiesStored:false,guessedRoutes:false,paginationRequests:0,detailRequests:0,apiRequests:0};
  const sourceRobots=await fetchBounded('https://worldauto.ge/robots.txt',{...HEADERS,accept:'text/plain,*/*;q=0.5'});const sourcePolicy=sourceRobots.ok?evaluateRobots(sourceRobots.body,SOURCE_URL,USER_AGENT):{allowed:true,matchedRule:null,applicableGroupCount:0};
  const backendRobots=await fetchBounded(`${BACKEND_ORIGIN}/robots.txt`,{...HEADERS,accept:'text/plain,*/*;q=0.5'});const backendPolicy=backendRobots.ok?evaluateRobots(backendRobots.body,ENDPOINT_URL,USER_AGENT):{allowed:true,matchedRule:null,applicableGroupCount:0,robotsUnavailable:true};
  if(!sourcePolicy.allowed||(backendRobots.ok&&!backendPolicy.allowed)){const p={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_search_prefix_evidence_no_write',sourceUrl:SOURCE_URL,endpointUrl:ENDPOINT_URL,...safety,requestCount:2,sourceRobots:{status:sourceRobots.status,policy:sourcePolicy},backendRobots:{status:backendRobots.status,policy:backendPolicy},response:null,decisionSignal:'robots_disallowed'};await fs.writeFile(OUTPUT_PATH,JSON.stringify(p,null,2));return p;}
  const response=await fetchBounded(ENDPOINT_URL);const recovered=extractFirstArrayObject(response.body);const summary=summarizeRecoveredWorldAutoItem(recovered.value);
  const payload={version:1,generatedAt:new Date().toISOString(),mode:'worldauto_search_prefix_evidence_no_write',sourceUrl:SOURCE_URL,backendOrigin:BACKEND_ORIGIN,endpointPath:ENDPOINT_PATH,endpointUrl:ENDPOINT_URL,...safety,apiRequests:1,requestCount:3,sourceRobots:{status:sourceRobots.status,bodyHashSha256:sourceRobots.bodyHashSha256,policy:sourcePolicy},backendRobots:{status:backendRobots.status,bodyHashSha256:backendRobots.bodyHashSha256,policy:backendPolicy},response:{status:response.status,contentType:response.contentType,truncated:response.truncated,bodyHashSha256:response.bodyHashSha256,bytes:Buffer.byteLength(response.body),firstArrayObject:{found:recovered.found,arrayOffset:recovered.arrayOffset,objectOffset:recovered.objectOffset,rawLength:recovered.rawLength},summary},decisionSignal:response.ok&&recovered.found?'offer_like_object_recovered_from_source_declared_search_prefix':response.ok?'search_response_received_no_balanced_array_object_in_prefix':`http_${response.status}`,next:response.ok&&recovered.found?'Review recovered offer-bound field coverage. Request no detail route until a detail identifier/route is source-declared.':'Keep WorldAuto research_pending; do not paginate or guess.'};
  await fs.writeFile(OUTPUT_PATH,JSON.stringify(payload,null,2));console.log(JSON.stringify({output:OUTPUT_PATH,status:response.status,truncated:response.truncated,recovered:payload.response.firstArrayObject,summary,decisionSignal:payload.decisionSignal},null,2));return payload;
}
const entry=process.argv[1]?pathToFileURL(process.argv[1]).href:'';if(entry===import.meta.url)runWorldAutoSearchPrefixEvidence().catch(e=>{console.error(e);process.exitCode=1;});
