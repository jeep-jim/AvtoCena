import {createHash,createHmac} from 'node:crypto';
const host='s3.regru.cloud',base='/avtocena-staging-8120751';
const prefix='migration-staging/full-20261011/catalog/private-market-stage-v1/china/full-fresh-44705142814-1/';
const access=process.env.REG_ACCESS,secret=process.env.REG_SECRET;
delete process.env.REG_ACCESS;delete process.env.REG_SECRET;
const sha=x=>createHash('sha256').update(x).digest('hex');
const h=(k,x)=>createHmac('sha256',k).update(x).digest();
const esc=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt().toString(16).toUpperCase());
const report=x=>console.log(JSON.stringify({...x,storageWrites:0,publicationAuthorized:false}));
async function fetchSigned(method,uri,pairs=[]){
 if(!access||!secret||!(uri===base&&method==='GET'||uri===base+'/'+prefix+'READY.json'&&method==='HEAD'))throw Error('scope');
 const time=new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),date=time.slice(0,8);
 const sig=date+'/us-east-1/s3/aws4_request',payload=sha('');
 const params=pairs.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>esc(key)+'='+esc(v)).join('&');
 const header='host;x-amz-content-sha256;x-amz-date';
 const request=[method,uri,params,'host:'+host+'\nx-amz-content-sha256:'+payload+'\nx-amz-date:'+time+'\n',header,payload].join('\n');
 const key=h(h(h(h('AWS4'+secret,date),'us-east-1'),'s3'),'aws4_request');
 const sign=createHmac('sha256',key).update('AWS4-HMAC-SHA256\n'+time+'\n'+sig+'\n'+sha(request)).digest('hex');
 return fetch('https://'+host+uri+(params?'?'+params:''),{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{host,
  'x-amz-content-sha256':payload,'x-amz-date':time,authorization:'AWS4-HMAC-SHA256 Credential='+access+'/'+sig+', SignedHeaders='+header+', Signature='+sign}});
}
async function readBounded(r){
 const reader=r.body.getReader();const parts=[];let n=0;
 try{for(;;){const x=await reader.read();if(x.done)break;n+=x.value.byteLength;if(n>700000){await reader.cancel();throw Error('response_bound');}parts.push(x.value);}}
 finally{reader.releaseLock();}
 return Buffer.concat(parts,n).toString('utf8');
}
try{
 const r=await fetchSigned('GET',base,[['list-type','2'],['max-keys','1000'],['prefix',prefix]]);
 if(r.status!==200){report({kind:'native_private_stage_list',http:r.status,usable:false});await r.body?.cancel();}
 else{
  const xml=await readBounded(r), n=Array.from(xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g),x=>x[1]);
  if(n.length>1000||n.some(x=>!x.includes('<Key>'+prefix)))throw Error('prefix_check');
  const time=n.map(x=>x.match(/<LastModified>([0-9T:.+Z-]+)<\/LastModified>/)?.[1]).filter(Boolean).sort();
  report({kind:'native_private_stage_list',http:r.status,objects:n.length,truncated:xml.includes('<IsTruncated>true</IsTruncated>'),earliest:time[0]??null,latest:time.at(-1)??null});
 }
}catch{report({kind:'native_private_stage_list',transportError:true});}
try{
 const r=await fetchSigned('HEAD',base+'/'+prefix+'READY.json');const len=r.headers.get('content-length');
 report({kind:'native_private_stage_ready',http:r.status,bytes:r.status===200&&/^\d+$/.test(len??'')?Number(len):null});
}catch{report({kind:'native_private_stage_ready',transportError:true});}
