// Bounded read-only audit: no source image downloads, customer data, writes or load generation.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve4,resolveNs} from 'node:dns/promises';
const report={at:new Date().toISOString(),scope:'Read-only snapshot; not a penetration or load test',dns:{},http:[],markets:[],cloud:{}};
const out='artifacts/security-photo-audit';fs.mkdirSync(out,{recursive:true});
for(const [key,fn] of [['addresses',resolve4],['nameservers',resolveNs]])try{report.dns[key]=await fn('avtocena.com')}catch(e){report.dns[key]={error:e.code}}
for(const path of ['/api/health','/crm','/api/crm/inbox']){
 try{const r=await fetch('https://avtocena.com'+path,{redirect:'manual',signal:AbortSignal.timeout(40000)});const row={path,status:r.status,headers:Object.fromEntries(['server','cf-ray','cf-cache-status','cache-control','x-content-type-options','x-frame-options','content-security-policy','referrer-policy','strict-transport-security','x-robots-tag','location'].map(k=>[k,r.headers.get(k)]))};if(path==='/api/health')row.health=await r.json();else await r.body?.cancel();report.http.push(row)}catch(e){report.http.push({path,error:String(e)})}
}
for(const market of ['japan','china','korea','uae','europe','georgia']){
 try{const r=await fetch(`https://avtocena.com/api/catalog/search?market=${market}&pageSize=2`,{signal:AbortSignal.timeout(40000)});if(!r.ok)throw Error('http_'+r.status);const d=await r.json();const items=(d.items||[]).slice(0,2).map(x=>{const images=(x.images||[]).map(v=>typeof v==='string'?v:v.url).filter(Boolean);return{id:x.id,images,hosts:[...new Set(images.map(u=>new URL(u,'https://avtocena.com').host))]}});report.markets.push({market,items});}catch(e){report.markets.push({market,error:String(e)})}
}
if(process.env.YC_SA_JSON_CREDENTIALS){
 try{
  const key=JSON.parse(process.env.YC_SA_JSON_CREDENTIALS),now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const iam='https://iam.api.cloud.yandex.net/iam/v1/tokens',unsigned=enc({alg:'PS256',typ:'JWT',kid:key.id})+'.'+enc({iss:key.service_account_id,aud:iam,iat:now,exp:now+600});
  const signature=crypto.sign('sha256',Buffer.from(unsigned),{key:key.private_key.slice(key.private_key.indexOf('-----BEGIN')),padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
  const ir=await fetch(iam,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:unsigned+'.'+signature}),signal:AbortSignal.timeout(20000)});if(!ir.ok)throw Error('iam_http_'+ir.status);const {iamToken}=await ir.json();
  const get=async(url)=>{const r=await fetch(url,{headers:{authorization:'Bearer '+iamToken},signal:AbortSignal.timeout(20000)});return r.ok?await r.json():{auditHttpStatus:r.status}};
  const folder='b1g9vq73onqb7dp5hgqg',base='https://serverless-containers.api.cloud.yandex.net/containers/v1/';
  const containers=await get(base+'containers?folderId='+folder);report.cloud.containersStatus=containers.auditHttpStatus||200;
  for(const c of (containers.containers||[]).filter(x=>x.name==='avtocena-web')){
   const revisions=await get(base+'revisions?containerId='+c.id);
   report.cloud.runtime=(revisions.revisions||[]).filter(x=>x.status==='ACTIVE').map(x=>({release:x.environment?.AVTOCENA_RELEASE_SHA,authSecretPresent:Boolean(x.environment?.AUTH_SECRET||x.environment?.NEXTAUTH_SECRET),captchaClientPresent:Boolean(x.environment?.SMARTCAPTCHA_CLIENT_KEY),captchaServerPresent:Boolean(x.environment?.SMARTCAPTCHA_SERVER_KEY),imageStorageMode:x.environment?.CATALOG_IMAGE_STORAGE_MODE||'source_urls_only (code default)',resources:x.resources,concurrency:x.concurrency,executionTimeout:x.executionTimeout,provisionPolicy:x.provisionPolicy,scalingPolicy:x.scalingPolicy}));
  }
  const gateways=await get('https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways?folderId='+folder);report.cloud.gateways={status:gateways.auditHttpStatus||200,items:(gateways.apiGateways||[]).map(x=>({name:x.name,status:x.status,securityProfileId:x.securityProfileId||null,customDomains:x.customDomains?.map(y=>y.fqdn)}))};
  const profiles=await get('https://smartwebsecurity.api.cloud.yandex.net/smartwebsecurity/v1/securityProfiles?folderId='+folder);report.cloud.securityProfiles={status:profiles.auditHttpStatus||200,count:profiles.securityProfiles?.length??null};
 }catch(e){report.cloud.error=String(e)}
}else report.cloud.notChecked='Cloud credentials were not supplied';
fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
