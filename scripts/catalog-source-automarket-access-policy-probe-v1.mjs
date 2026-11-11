import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const OUT='catalog-source-automarket-access-policy-probe-v1.json';
const SOURCE_ID='automarket_uae_candidate';
const ORIGIN='https://www.automarket.ae';
const UA='AvtoCenaQualificationProbe/1.0 (+read-only source qualification)';
const MAX_BYTES=1400000;
const TIMEOUT_MS=20000;

async function readLimited(response,maxBytes=MAX_BYTES){
  if(!response.body)return {text:'',bytes:0,truncated:false};
  const reader=response.body.getReader(); const chunks=[]; let bytes=0; let truncated=false;
  try{while(bytes<maxBytes){const {done,value}=await reader.read(); if(done)break; const n=Math.min(value.byteLength,maxBytes-bytes); chunks.push(value.subarray(0,n)); bytes+=n; if(n<value.byteLength){truncated=true;break;}} if(bytes>=maxBytes)truncated=true;}finally{if(truncated)await reader.cancel().catch(()=>{});}
  const buf=Buffer.concat(chunks.map(x=>Buffer.from(x))); return {text:buf.toString('utf8'),bytes:buf.length,truncated};
}
async function get(url,accept='text/html,application/xhtml+xml,*/*;q=0.5'){
  const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'en-US,en;q=0.9','cache-control':'no-cache',accept},redirect:'follow',signal:AbortSignal.timeout(TIMEOUT_MS)});
  const body=await readLimited(r,url.endsWith('/robots.txt')?300000:MAX_BYTES);
  return {status:r.status,ok:r.ok,finalUrl:r.url||url,contentType:r.headers.get('content-type')||'',text:body.text,capturedBytes:body.bytes,truncated:body.truncated,hashSha256:crypto.createHash('sha256').update(body.text).digest('hex')};
}
function clean(s){return String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
function anchors(html){const out=[]; for(const m of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){try{const u=new URL(m[1],ORIGIN); if(u.origin!==ORIGIN)continue; const text=clean(m[2]); out.push({url:u.href,text});}catch{}} return out;}
function snippets(text,re,limit=8,radius=180){const out=[]; for(const m of String(text||'').matchAll(re)){const a=Math.max(0,(m.index||0)-radius),b=Math.min(text.length,(m.index||0)+m[0].length+radius); const s=text.slice(a,b).replace(/\s+/g,' ').trim(); if(!out.includes(s))out.push(s); if(out.length>=limit)break;} return out;}
const result={version:1,generatedAt:new Date().toISOString(),sourceId:SOURCE_ID,mode:'permission_first_source_declared_legal_link_no_write',productionWrites:false,classificationMutations:false,publishAllowedMutations:false,objectStorageWrites:false,catalogGenerationWrites:false,rawBodiesStored:false,guessedRoutes:false,requestCount:0,robotsRequests:0,homeRequests:0,policyRequests:0,detailRequests:0,paginationRequests:0,apiRequests:0};
try{
  const robots=await get(`${ORIGIN}/robots.txt`,'text/plain,*/*;q=0.5'); result.requestCount++; result.robotsRequests=1; result.robots={status:robots.status,finalUrl:robots.finalUrl,hashSha256:robots.hashSha256};
  if(!robots.ok && ![404,410].includes(robots.status)) throw new Error(`robots_http_${robots.status}`);
  const home=await get(`${ORIGIN}/`); result.requestCount++; result.homeRequests=1; result.home={status:home.status,finalUrl:home.finalUrl,contentType:home.contentType,hashSha256:home.hashSha256,capturedBytes:home.capturedBytes};
  if(!home.ok) throw new Error(`home_http_${home.status}`);
  const links=anchors(home.text).filter(x=>/(terms|condition|privacy|legal|policy|copyright|rules|agreement)/i.test(`${x.text} ${x.url}`));
  result.sourceDeclaredLegalLinks=[...new Map(links.map(x=>[x.url,x])).values()].slice(0,12);
  const candidate=result.sourceDeclaredLegalLinks[0];
  if(candidate){
    const policy=await get(candidate.url); result.requestCount++; result.policyRequests=1;
    result.policy={url:candidate.url,status:policy.status,finalUrl:policy.finalUrl,contentType:policy.contentType,hashSha256:policy.hashSha256,capturedBytes:policy.capturedBytes};
    if(policy.ok){const visible=clean(policy.text); result.policy.automationRestrictionSnippets=snippets(visible,/(scrap(?:e|ing)|crawler|spider|robot|automated|automation|data\s*mining|harvest)/gi); result.policy.reuseRestrictionSnippets=snippets(visible,/(commercial\s+use|commercially|reuse|re-use|reproduce|copy(?:ing)?|extract(?:ion)?|database|republish|license)/gi); result.permissionConclusion=(result.policy.automationRestrictionSnippets.length||result.policy.reuseRestrictionSnippets.length)?'manual_review_required_before_any_inventory_probe':'no_explicit_automation_or_reuse_rule_detected_on_source_declared_policy_page_but_no_positive_permission_granted';}
    else result.permissionConclusion='source_declared_policy_link_not_readable_permission_unproven';
  }else result.permissionConclusion='no_source_declared_legal_link_detected_on_home_permission_unproven';
  result.completed=true;
}catch(error){result.completed=false; result.error=String(error?.message||error);}
await fs.writeFile(OUT,`${JSON.stringify(result,null,2)}\n`);
console.log(JSON.stringify({output:OUT,completed:result.completed,requestCount:result.requestCount,permissionConclusion:result.permissionConclusion||null,error:result.error||null},null,2));
if(!result.completed)process.exitCode=1;
