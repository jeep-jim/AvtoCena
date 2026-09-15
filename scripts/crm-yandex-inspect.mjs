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
const hosts=[
 ['containers','https://serverless-containers.api.cloud.yandex.net/containers/v1/containers?folderId='+folder],
 ['functions','https://serverless-functions.api.cloud.yandex.net/functions/v1/functions?folderId='+folder],
 ['gateways','https://serverless-apigateway.api.cloud.yandex.net/apigateways/v1/apigateways?folderId='+folder],
 ['instances','https://compute.api.cloud.yandex.net/compute/v1/instances?folderId='+folder]
];
for(const [kind,url] of hosts){
 const d=await get(url), items=d[kind]||d.apiGateways||[];
 console.log(JSON.stringify({kind,resources:items.map(x=>({id:x.id,name:x.name,status:x.status,url:x.url,domain:x.domain,networkId:x.networkId}))}));
 if(kind==='containers')for(const c of items.filter(x=>x.name==='avtocena-web')){
 const rev=await get('https://serverless-containers.api.cloud.yandex.net/containers/v1/revisions?containerId='+c.id);
 console.log(JSON.stringify({revisions:(rev.revisions||[]).slice(0,2).map(x=>({id:x.id,status:x.status,networkId:x.networkId,resources:x.resources,executionTimeout:x.executionTimeout,provisionPolicy:x.provisionPolicy,connectivity:x.connectivity}))}));
 }
}

const relayKey=crypto.createHmac('sha256',process.env.AUTH_ACCESS_KEY||'').update('avtocena:crm-notification-relay:v1').digest('hex');
for(const origin of ['https://avtocena.com','https://bbaohms2ccpm3vb4e73t.containers.yandexcloud.net']){
 try{
 const r=await fetch(origin+'/api/internal/crm/relay',{method:'POST',headers:{'content-type':'application/json','x-crm-relay-key':relayKey},body:JSON.stringify({action:'network'}),signal:AbortSignal.timeout(25000)});
 const d=await r.json();
 console.log('NETWORK_CHECK '+JSON.stringify({origin,status:r.status,ok:d.ok,releaseSha:d.releaseSha,polling:d.polling,checks:d.checks,bot:d.bot}));
 }catch{console.log('NETWORK_CHECK '+JSON.stringify({origin,error:'request_failed'}));}
}
