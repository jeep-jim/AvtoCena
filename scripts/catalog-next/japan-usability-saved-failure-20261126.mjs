// Three fixed saved failure objects only. No application imports, supplier calls or writes.
import {fileURLToPath} from 'node:url';
import {createHash,createHmac} from 'node:crypto';
export async function inspectSavedFailure({env=process.env,fetcher=globalThis.fetch}={}){
const hash=x=>createHash('sha256').update(x).digest('hex');
const hmac=(key,value)=>createHmac('sha256',key).update(value).digest();
const keys=[['stats-list-1','integrations/ajes/catalog-failure-pages/stats-list-1.json'],['stats-count','integrations/ajes/catalog-failure-pages/stats-count.json'],['stats-latest','integrations/ajes/catalog-failure-stats.json']];
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max?x:null;
const timestamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x))?x:null;
const outcomes=/^(?:http_[1-5]\d{2}|visitor_restricted|request_failed|request_timeout|connect_timeout|quota_exhausted|quota_busy|local_busy|invalid_response|empty_response|query_too_large|response_too_large|identity_mismatch)$/;
const sanitize=value=>({startedAt:timestamp(value?.startedAt),finishedAt:timestamp(value?.finishedAt),
 kind:['list','detail','count','models','makes','colors'].includes(value?.kind)?value.kind:null,
 outcome:typeof value?.outcome==='string'&&outcomes.test(value.outcome)?value.outcome:null,
 page:int(value?.page,1,1000000),pageSize:int(value?.pageSize,1,500),httpStatus:int(value?.httpStatus,100,599),
 providerCode:typeof value?.providerCode==='string'&&/^(?:bot|ban)\d{0,13}$/.test(value.providerCode)?value.providerCode:null,
 sqlSha256:typeof value?.sql==='string'?hash(value.sql):null,sqlBytes:typeof value?.sql==='string'?Buffer.byteLength(value.sql):null});
let total=0;
const records=[];
try {
 if(!env.REGCLOUD_S3_ACCESS_KEY_ID||!env.REGCLOUD_S3_SECRET_ACCESS_KEY)throw Error();
 const endpoint=new URL('https://s3.regru.cloud');
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error();
 const bucket='avtocena-staging-8120751',access=env.REGCLOUD_S3_ACCESS_KEY_ID||'',secret=env.REGCLOUD_S3_SECRET_ACCESS_KEY||'';
 const region='us-east-1',prefix='migration-staging/full-20261011';
 if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||!access||!secret||prefix.split('/').some(x=>x==='.'||x==='..'))throw Error();
 const signal=AbortSignal.timeout(20000);
 for(const [slot,key] of keys){
  if(signal.aborted){records.push({slot,readStatus:'deadline'});continue;}
  if(total>=128*1024){records.push({slot,readStatus:'byte_limit'});continue;}
  try {
   const full=[prefix,key].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
   const url=new URL(endpoint.href.replace(/\/+$/g,'')+'/'+bucket+'/'+full);
   if(url.origin!==endpoint.origin)throw Error();
   const date=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),day=date.slice(0,8),payload=hash('');
   const headers={host:url.host,'x-amz-content-sha256':payload,'x-amz-date':date};
   const signed=Object.keys(headers).sort().join(';');
   const canonical=Object.keys(headers).sort().map(k=>k+':'+headers[k].trim()+'\n').join('');
   const scope=day+'/'+region+'/s3/aws4_request';
   const toSign=['AWS4-HMAC-SHA256',date,scope,hash(['GET',url.pathname,'',canonical,signed,payload].join('\n'))].join('\n');
   const signing=hmac(hmac(hmac(hmac('AWS4'+secret,day),region),'s3'),'aws4_request');
   headers.authorization='AWS4-HMAC-SHA256 Credential='+access+'/'+scope+', SignedHeaders='+signed+', Signature='+createHmac('sha256',signing).update(toSign).digest('hex');
   const response=await fetcher(url,{method:'GET',headers,redirect:'error',signal});
   if(response.status!==200){await response.body?.cancel();records.push({slot,readStatus:response.status===404?'missing':'unavailable'});continue;}
   const limit=Math.min(64*1024,128*1024-total);
   if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();records.push({slot,readStatus:'byte_limit'});continue;}
   const reader=response.body?.getReader();if(!reader)throw Error();
   const chunks=[];let bytes=0,oversize=false;
   while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;bytes+=value.byteLength;
    if(bytes>limit||total>128*1024){oversize=true;await reader.cancel();break;}chunks.push(value);}
   if(oversize){records.push({slot,readStatus:'byte_limit'});continue;}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
   records.push({slot,readStatus:'ok',...sanitize(value)});
  } catch {records.push({slot,readStatus:signal.aborted?'deadline':'unavailable'});}
 }
 return {version:1,kind:'japan-usability-saved-failure-v1',records,supplierRequests:0,writes:0};
} catch {return {version:1,kind:'japan-usability-saved-failure-v1',readStatus:'configuration_unavailable',records:[],supplierRequests:0,writes:0};}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const workflows=new Set(['japan-usability-saved-failure-20261126.yml','catalog-next-china-photo-release.yml'].map(name=>'jeep-jim/AvtoCena/.github/workflows/'+name+'@refs/heads/main'));
 if(process.argv.length!==3||process.argv[2]!=='--run'||process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY_ID!=='1289722938'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1'||!workflows.has(process.env.GITHUB_WORKFLOW_REF)||!['push','workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)){
  console.log(JSON.stringify({readStatus:'invocation_rejected'}));process.exitCode=1;
 }else{const report=await inspectSavedFailure();console.log(JSON.stringify(report));if(report.readStatus||report.records.some(row=>!['ok','missing'].includes(row.readStatus)))process.exitCode=1;}
}
