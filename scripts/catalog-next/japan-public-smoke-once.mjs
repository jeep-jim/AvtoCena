// One bounded public request made by this GitHub runner's actual visitor IP.
// Never fake an X-Real-IP, read supplier credentials or enumerate Japan lots.
const origin = 'https://avtocena.com';
const url = origin + '/api/catalog/search?market=japan&page=1&pageSize=3&yearFrom=2008';
const started=Date.now();
let result={kind:'japan-public-supplier-smoke-v1',providerRequestsFromThisScript:0,
  market:'japan',visitorIpSpoofed:false};
try {
  const response=await fetch(url,{headers:{Accept:'application/json'},
    redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});
  const chunks=[];let total=0;
  for await(const part of response.body??[]) {
    total+=part.byteLength;
    if(total>512*1024) throw Error('response_too_large');
    chunks.push(Buffer.from(part));
  }
  let body;
  try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{body=null;}
  const items=Array.isArray(body?.items)?body.items:[];
  result={...result,httpStatus:response.status,elapsedMs:Date.now()-started,
    jsonValid:body!==null,applicationOk:body?.ok===true,
    returnedItems:items.length,
    japanItems:items.filter(x=>x?.market==='japan').length,
    hasNextCursor:typeof body?.nextCursor==='string',
    providerObservedAtValid:Number.isFinite(Date.parse(body?.observedAt||body?.generationId||'')),
    countIncomplete:body?.countIncomplete===true,
    stale:body?.stale===true,
    failureCode:response.ok?null:
      (typeof body?.reason==='string'&&/^[a-z0-9_]{1,90}$/.test(body.reason)?body.reason:'http_'+response.status)};
} catch(e) {
  const error=String(e?.message||'');
  result={...result,elapsedMs:Date.now()-started,transportError:
    error==='response_too_large'?'response_too_large':error.includes('aborted')||error.includes('timeout')?'timeout':'transport'};
}
console.log(JSON.stringify(result));
