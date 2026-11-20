import {createHash,createHmac} from 'node:crypto';
const host='s3.regru.cloud',base='/avtocena-staging-8120751';
const prefix='migration-staging/full-20261011/catalog/private-market-stage-v1/china/full-fresh-44710087159-1/';
const root=base+'/'+prefix,gen=/^gen_\d{13}_china44710087159$/,hex=/^[a-f0-9]{64}$/;
const scope=new Set([root+'READY.json']);
const access=process.env.REG_ACCESS,secret=process.env.REG_SECRET;
delete process.env.REG_ACCESS;delete process.env.REG_SECRET;
const sha=x=>createHash('sha256').update(x).digest('hex');
const h=(k,x)=>createHmac('sha256',k).update(x).digest();
const esc=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt().toString(16).toUpperCase());
const report=x=>console.log(JSON.stringify({...x,storageWrites:0,publicationAuthorized:false}));
async function fetchSigned(method,uri,pairs=[]){
 if(!access||!secret||!(uri===base&&method==='GET'||uri===root+'READY.json'&&method==='HEAD'||method==='GET'&&scope.has(uri)))throw Error('scope');
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
const one=(xml,pattern)=>xml.match(pattern)?.[1];
try{
 let count=0,first=null,last=null,continuation;
 for(let page=0;page<15;page++){
  const pairs=[['list-type','2'],['max-keys','1000'],['prefix',prefix]];
  if(continuation)pairs.push(['continuation-token',continuation]);
  const r=await fetchSigned('GET',base,pairs);
  if(r.status!==200){await r.body?.cancel(); report({kind:'fast_stage_list',http:r.status,verified:false});break;}
  const xml=await readBounded(r),entries=[...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(x=>x[1]);
  if(entries.length>1000||entries.some(x=>!x.includes('<Key>'+prefix)))throw Error('prefix_check');
  for(const item of entries){
   const t=one(item,/<LastModified>([0-9T:+.Z-]+)<\/LastModified>/);
   if(t&&Number.isFinite(Date.parse(t))){if(first===null||t<first)first=t;if(last===null||t>last)last=t;}
  }
  count+=entries.length;
  const truncated=xml.includes('<IsTruncated>true</IsTruncated>');
  if(!truncated||page===14){report({kind:'fast_stage_list',http:200,count,truncated,first,last});break;}
  const next=one(xml,/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  if(!next||next===continuation||!/^[-+A-Za-z0-9_=/.:]+$/.test(next))throw Error('pagination');
  continuation=next;
 }
}catch{report({kind:'fast_stage_list',verified:false});}
try{
 const r=await fetchSigned('GET',root+'READY.json');
 if(r.status!==200){await r.body?.cancel();report({kind:'fast_stage_ready',http:r.status});}
 else{
  const raw=await readBounded(r),d=JSON.parse(raw);
  const archive='b8a2a25dc27390845dd5a423efa323c9472a338b1b97f413ba96aefa7f3b65ca';
  if(raw.length>16384||d.version!==1||d.kind!=='china-private-durable-stage-ready-v1'||d.market!=='china'||
    d.runId!=='full-fresh-44710087159-1'||d.stageRoot!=='catalog/private-market-stage-v1/china/'+d.runId+'/'||
    !gen.test(d.generationId)||d.archiveSha256!==archive||d.expectedChinaPublicBaseSha256!==sha('null')||
    ![d.runtimeReadySha256,d.manifestSha256,d.pricingReceiptSha256,d.permitSha256,d.activeControlSha256].every(x=>typeof x==='string'&&hex.test(x))||
    !Number.isSafeInteger(d.admittedRows)||d.admittedRows<100000||d.admittedRows>290044||
    !Number.isSafeInteger(d.validUntil)||d.publicationAuthorized!==false||d.cursorAdvanceAuthorized!==false)throw Error('ready_identity');
  report({kind:'fast_stage_ready',http:200,readySha256:sha(raw),generationId:d.generationId,admittedRows:d.admittedRows,
   manifestSha256:d.manifestSha256,archiveSha256:d.archiveSha256,pricingReceiptSha256:d.pricingReceiptSha256,
   expectedChinaPublicBaseSha256:d.expectedChinaPublicBaseSha256,validUntil:d.validUntil,runtimeReadySha256:d.runtimeReadySha256,cursorAdvanceAuthorized:false});
 }
}catch{report({kind:'fast_stage_ready',verified:false});}
