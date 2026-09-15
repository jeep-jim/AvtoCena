import crypto from 'node:crypto';
const key=JSON.parse(process.env.YC_SA_JSON_CREDENTIALS||'{}');
const now=Math.floor(Date.now()/1000), enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const iam='https://iam.api.cloud.yandex.net/iam/v1/tokens';
const unsigned=enc({alg:'PS256',typ:'JWT',kid:key.id})+'.'+enc({iss:key.service_account_id,aud:iam,iat:now,exp:now+600});
const sig=crypto.sign('sha256',Buffer.from(unsigned),{key:key.private_key.slice(key.private_key.indexOf('-----BEGIN')),padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url');
const ir=await fetch(iam,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jwt:unsigned+'.'+sig})});
if(!ir.ok)throw Error('iam_http_'+ir.status);
const {iamToken}=await ir.json();
async function get(url){const r=await fetch(url,{headers:{Authorization:'Bearer '+iamToken},signal:AbortSignal.timeout(15000)});if(!r.ok){console.log(JSON.stringify({endpoint:new URL(url).pathname,status:r.status}));return {};}return r.json();}
const folder='b1g9vq73onqb7dp5hgqg';

const root='https://serverless-containers.api.cloud.yandex.net/containers/v1';
const cid='bbaohms2ccpm3vb4e73t', nid='enpvs5b9iu9p2ho0iae8';
const origin='https://bbaohms2ccpm3vb4e73t.containers.yandexcloud.net';
const relayKey=crypto.createHmac('sha256',process.env.AUTH_ACCESS_KEY||'').update('avtocena:crm-notification-relay:v1').digest('hex');
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+iamToken,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('api_http_'+r.status);return r.json();}
async function operation(op){for(let i=0;i<80;i++){if(op.done){if(op.error)throw Error('operation_code_'+op.error.code);return op;}await new Promise(r=>setTimeout(r,3000));op=await get('https://operation.api.cloud.yandex.net/operations/'+op.id);}throw Error('operation_timeout');}
async function probe(){const r=await fetch(origin+'/api/internal/crm/relay',{method:'POST',headers:{'content-type':'application/json','x-crm-relay-key':relayKey},body:JSON.stringify({action:'network'}),signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('runtime_http_'+r.status);return r.json();}
const initial=await probe();
if(initial.releaseSha!=='0924aecc4d2df6894377960c2a0c243129a9d5ba')throw Error('release_changed');
if(initial.bot?.ok){console.log('Telegram already reachable; no mutation needed');process.exit(0);}
const revisions=await get(root+'/revisions?containerId='+cid);
const old=revisions.revisions?.find(x=>x.status==='ACTIVE');
if(!old || old.connectivity?.networkId || old.image?.environment?.AVTOCENA_RELEASE_SHA!==initial.releaseSha)throw Error('unexpected_revision');
const vm=await get('https://compute.api.cloud.yandex.net/compute/v1/instances/fhmvvsmoc6vpu3jbbhkc');
const network=await get('https://vpc.api.cloud.yandex.net/vpc/v1/networks/'+nid);
const subnetReply=await get('https://vpc.api.cloud.yandex.net/vpc/v1/subnets?folderId='+folder);
const subnets=(subnetReply.subnets||[]).filter(x=>x.networkId===nid);
if(network.name!=='avtocena-browser-pilot'||!vm.networkInterfaces?.some(x=>x.primaryV4Address?.address&&subnets.some(s=>s.id===x.subnetId)))throw Error('network_identity_missing');
const zr=await get('https://compute.api.cloud.yandex.net/compute/v1/zones');
// Public Russia zones from Yandex geo-scope documentation (2026-06-16).
const documentedZones=['ru-central1-a','ru-central1-b','ru-central1-d','ru-central1-e'];
const up=(zr.zones||[]).filter(x=>x.status==='UP').map(x=>x.id);
const zones=documentedZones.filter(x=>up.includes(x));
console.log('Network preflight '+JSON.stringify({zones,subnetZones:subnets.map(x=>x.zoneId),oldRevision:old.id,vmStatus:vm.status}));
if(zones.length!==documentedZones.length)throw Error('documented_zone_unavailable');
function range(cidr){const [ip,bits]=cidr.split('/'), n=ip.split('.').reduce((a,b)=>(a*256)+Number(b),0), width=2**(32-Number(bits));const lo=Math.floor(n/width)*width;return [lo,lo+width-1];}
const existing=subnets.flatMap(x=>x.v4CidrBlocks||[]).map(range);
const created=[];
let deployed=false, kept=false;
try{
 for(const [i,zone] of zones.entries()){
  if(subnets.some(x=>x.zoneId===zone))continue;
  const block='10.241.'+(201+i)+'.0/24', candidate=range(block);
  if(existing.some(r=>candidate[0]<=r[1]&&r[0]<=candidate[1]))throw Error('cidr_overlap');
  const op=await operation(await post('https://vpc.api.cloud.yandex.net/vpc/v1/subnets',{folderId:folder,networkId:nid,zoneId:zone,name:'avtocena-crm-runtime-'+zone.slice(-1),v4CidrBlocks:[block]}));
  created.push(op.response?.id||op.metadata?.subnetId);
  console.log('Created missing subnet in '+zone);
 }
 const imageSpec={...old.image};delete imageSpec.imageDigest;
 const spec={containerId:cid,description:'CRM Telegram VPC connectivity trial',imageSpec,connectivity:{networkId:nid}};
 for(const name of ['resources','executionTimeout','serviceAccountId','concurrency','provisionPolicy','secrets','logOptions','scalingPolicy','storageMounts','mounts','runtime','metadataOptions','asyncInvocationConfig'])if(old[name]!==undefined)spec[name]=old[name];
 deployed=true;
 const op=await operation(await post(root+'/revisions:deploy',spec));
 console.log('Trial revision ready '+(op.response?.id||op.metadata?.containerRevisionId));
 await new Promise(r=>setTimeout(r,10000));
 for(let i=0;i<3;i++){
  try{const result=await probe();console.log('Trial network '+JSON.stringify({releaseSha:result.releaseSha,bot:result.bot,checks:result.checks}));if(result.releaseSha===initial.releaseSha && result.bot?.ok){kept=true;break;}}catch{console.log('Trial probe unavailable');}
  await new Promise(r=>setTimeout(r,5000));
 }
 if(!kept)throw Error('telegram_still_unreachable');
 console.log('VPC network kept; Telegram getMe verified. No VM or NAT created.');
}catch(e){
 console.log('Trial outcome '+(e instanceof Error?e.message:'failed'));
 if(deployed){await operation(await post(root+'/containers/'+cid+':rollback',{revisionId:old.id}));console.log('Rollback completed to '+old.id);const p=await probe();if(p.releaseSha!==initial.releaseSha)throw Error('rollback_release_mismatch');console.log('Rollback runtime confirmed');}
 for(const id of created.filter(Boolean)){const r=await fetch('https://vpc.api.cloud.yandex.net/vpc/v1/subnets/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+iamToken}});console.log('Trial subnet cleanup status '+r.status);if(r.ok)await operation(await r.json());}
 process.exitCode=1;
}
