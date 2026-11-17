import assert from 'node:assert/strict';
import http from 'node:http';import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';
import {PRICE_CONFIG_KEYS} from './price-snapshot.mjs';
export function installChinaFullpriceNetworkGuard({generationId,manifestSha256,knowledgeRelease,knowledgeDigest,fetchImpl=globalThis.fetch.bind(globalThis),deadline=Date.now()+20*60000,native=true}){
 assert.match(knowledgeRelease,/^[a-f0-9]{40}$/);assert.match(knowledgeDigest,/^[a-f0-9]{64}$/);
 assert.match(generationId,/^gen_[0-9]+_[a-z0-9-]+$/);assert.match(manifestSha256,/^[a-f0-9]{64}$/);let selectedChunk=null;
 const allowed=new Set(['catalog/manifest.json']),fixed=new Set([...PRICE_CONFIG_KEYS,`knowledge/encyclopedia/calculation-releases/${knowledgeRelease}.json`,`knowledge/encyclopedia/calculation-indexes/${knowledgeDigest}.json`]);
 let forbidden=0,requests=0,cbr=0,wireBytes=0;const saved=[];const prefix='/avtocena-staging-8120751/migration-staging/full-20261011/';
 const deny=()=>{forbidden++;throw Error('fullprice_network_forbidden');};
 function authorizeStorageRead(key){if(typeof key!=='string'||(!fixed.has(key)&&!/^catalog\/(?:power-knowledge\/vehicles|power-reference\/30-minute-power)-[0-9]{4}(?:-[a-f0-9-]{36})?\.json$/.test(key)))return deny();allowed.add(key);}
 async function fetch(input,options={}){const url=new URL(typeof input==='string'||input instanceof URL?input:input.url),method=String(options.method||input?.method||'GET').toUpperCase();
 if(options.body!=null||!['GET','HEAD'].includes(method)||url.username||url.password||url.search||url.hash||++requests>320||Date.now()>=deadline)return deny();
 if(url.href==='https://www.cbr.ru/scripts/XML_daily.asp'){if(method!=='GET'||++cbr>1||new Headers(options.headers??input?.headers).has('authorization'))return deny();}
 else if(url.origin!=='https://s3.regru.cloud'||!url.pathname.startsWith(prefix)||!allowed.has(decodeURIComponent(url.pathname.slice(prefix.length))))return deny();
 const signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));const response=await fetchImpl(input,{...options,redirect:'error',signal:options.signal?AbortSignal.any([options.signal,signal]):signal});
 const key=url.pathname.startsWith(prefix)?decodeURIComponent(url.pathname.slice(prefix.length)):null;const limit=url.origin==='https://www.cbr.ru'?2*1024**2:key==='catalog/manifest.json'?2*1024**2:key===selectedChunk?16*1024**2:192*1024**2;
 if(Number(response.headers.get('content-length')||0)>limit){await response.body?.cancel();return deny();}
 if(method==='HEAD'||!response.body)return response;
 const reader=response.body.getReader();let bytes=0;return new Response(new ReadableStream({async pull(controller){try{const part=await reader.read();if(part.done){controller.close();return;}bytes+=part.value.length;wireBytes+=part.value.length;if(bytes>limit||wireBytes>360*1024**2){await reader.cancel();deny();}controller.enqueue(part.value);}catch(error){controller.error(error);}},async cancel(reason){await reader.cancel(reason);}}),{status:response.status,statusText:response.statusText,headers:response.headers});}
 if(native){for(const m of [http,https])for(const k of ['request','get']){saved.push([m,k,m[k]]);m[k]=deny;}syncBuiltinESMExports();}
 return {fetch,authorizeStorageRead,authorizeManifestChunk(chunk,verifiedManifestSha){if(verifiedManifestSha!==manifestSha256||selectedChunk!==null||typeof chunk!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(chunk))return deny();selectedChunk=`catalog/generations/${generationId}/offers/china/${chunk}.json`;allowed.add(selectedChunk);return selectedChunk;},assertClean(){assert.equal(forbidden,0,'fullprice_forbidden_attempt');assert.ok(Date.now()<deadline,'fullprice_deadline');},receipt:()=>({requests,forbidden,cbrRequests:cbr,wireBytes}),restore(){for(const [m,k,f]of saved)m[k]=f;syncBuiltinESMExports();}};
}
