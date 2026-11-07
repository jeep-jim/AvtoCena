import fs from 'node:fs';
import crypto from 'node:crypto';
import {getJsonStorage} from '../../apps/web/lib/data.ts';
const dir='retirement-preflight';fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(data,null,2));
const storage=getJsonStorage(),result={at:new Date().toISOString(),manifests:{},workflowDestinations:[],errors:[]};
for(const path of ['catalog/manifest.json','catalog/previous-manifest.json','catalog/internal/manifest.json','catalog/import-lock.json','catalog/japan-auction-history/manifest.json']){
 try{
 const value=await storage.readJson(path,null);if(!value){result.manifests[path]={present:false};continue;}
 const refs=new Set(),generations=new Set();
 const walk=v=>{if(typeof v==='string'){for(const m of v.matchAll(/gen_\d+_[-a-z0-9]+/gi))generations.add(m[0].replace(/-chunk-\d+$/,''));if(v.startsWith('catalog/'))refs.add(v);}else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};walk(value);
 result.manifests[path]={present:true,sha256:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'),generationId:value.generationId,generations:[...generations],referenceCount:refs.size,referencePrefixes:[...new Set([...refs].map(k=>k.split('/').slice(0,4).join('/')))].slice(0,50),markets:value.markets?Object.fromEntries(Object.entries(value.markets).map(([k,v])=>[k,{count:v.count,chunks:v.chunks?.length}])):undefined,sources:value.sources?Object.fromEntries(Object.entries(value.sources).map(([k,v])=>[k,{count:v.count,chunks:v.chunks?.length}])):undefined,lockedUntil:value.lockedUntil,activeLock:Date.parse(value.lockedUntil||'')>Date.now()};
 }catch(e){result.errors.push({path,error:e.name});}
}
try{const r=await fetch('https://avtocena.com/api/health',{signal:AbortSignal.timeout(15000)}),h=await r.json();result.health={status:r.status,ok:h.ok,releaseSha:h.releaseSha,calculationVersion:h.calculationVersion};}catch{result.errors.push({stage:'health',error:'read_failed'});}
save('live-references',result);
// Only workflows physically present in this revision can be retired. Historical
// workflow registry entries are not assumed to be active/current files.
for(const name of fs.readdirSync('.github/workflows').filter(n=>/\.ya?ml$/.test(n))){
 const path='.github/workflows/'+name,s=fs.readFileSync(path,'utf8');
 if(!/secrets\.YC_OBJECT_STORAGE|secrets\.YC_SA_JSON/.test(s))continue;
 const scheduled=/^\s{2}schedule:/m.test(s),entry={path,legacyStorageSecrets:/secrets\.YC_OBJECT_STORAGE/.test(s),regStorageSecrets:/secrets\.REGCLOUD_S3/.test(s),yandexServiceAccount:/secrets\.YC_SA_JSON/.test(s),scheduled,automaticCompletion:/^\s{2}workflow_run:/m.test(s)};
 if(scheduled||name==='deploy-yandex.yml')try{const r=await fetch('https://api.github.com/repos/jeep-jim/AvtoCena/actions/workflows/'+encodeURIComponent(name),{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('http_'+r.status);const d=await r.json();entry.id=d.id;entry.state=d.state;}catch(e){entry.error=e.message;}
 result.workflowDestinations.push(entry);
}
save('live-references',result);
const report={at:new Date().toISOString(),readOnly:true,resources:{},errors:[]};
try{
 const key=JSON.parse(process.env.YC_SA_JSON_CREDENTIALS||'{}');if(!key.id||!key.service_account_id||!key.private_key)throw Error('service_account_unavailable');
 const iam='https://iam.api.cloud.yandex.net/iam/v1/tokens',now=Math.floor(Date.now()/1000),enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const unsigned=enc({alg:'PS256',typ:'JWT',kid:key.id})+'.'+enc({iss:key.service_account_id,aud:iam,iat:now,exp:now+600});
 const signature=crypto.sign('sha256',Buffer.from(unsigned),{key:key.private_key.slice(key.private_key.indexOf('-----BEGIN')),padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
 const ir=await fetch(iam,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:unsigned+'.'+signature}),signal:AbortSignal.timeout(15000)});if(!ir.ok)throw Error('iam_http_'+ir.status);const {iamToken}=await ir.json();
 const folder='b1g9vq73onqb7dp5hgqg';
 const specs=[['containers','https://serverless-containers.api.cloud.yandex.net/containers/v1/containers','containers'],['functions','https://serverless-functions.api.cloud.yandex.net/functions/v1/functions','functions'],['gateways','https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways','apiGateways'],['instances','https://compute.api.cloud.yandex.net/compute/v1/instances','instances'],['disks','https://compute.api.cloud.yandex.net/compute/v1/disks','disks'],['addresses','https://vpc.api.cloud.yandex.net/vpc/v1/addresses','addresses'],['registries','https://container-registry.api.cloud.yandex.net/container-registry/v1/registries','registries'],['buckets','https://storage.api.cloud.yandex.net/storage/v1/buckets','buckets']];
 for(const [kind,endpoint,field] of specs){let token='',all=[],complete=false;try{for(let i=0;i<20;i++){const u=new URL(endpoint);u.searchParams.set('folderId',folder);u.searchParams.set('pageSize','100');if(token)u.searchParams.set('pageToken',token);const r=await fetch(u,{headers:{Authorization:'Bearer '+iamToken},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('http_'+r.status);const d=await r.json();if(d[field]!==undefined&&!Array.isArray(d[field]))throw Error('invalid_response');all.push(...(d[field]||[]).map(x=>({id:x.id,name:x.name,status:x.status,size:x.size,createdAt:x.createdAt})));token=d.nextPageToken||'';if(!token){complete=true;break;}}report.resources[kind]={complete,items:all};}catch(e){report.resources[kind]={complete:false,items:all};report.errors.push({kind,error:e.message});}save('yandex-resources',report);}
}catch(e){report.errors.push({stage:'authentication',error:e.message});}
save('yandex-resources',report);
console.log(JSON.stringify({readOnly:true,manifestErrors:result.errors,yandexErrors:report.errors,legacyScheduled:result.workflowDestinations.filter(x=>x.scheduled).map(x=>({path:x.path,state:x.state,id:x.id})),resources:Object.fromEntries(Object.entries(report.resources).map(([k,v])=>[k,{complete:v.complete,count:v.items.length}]))}));
