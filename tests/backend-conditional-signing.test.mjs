import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import crypto from 'node:crypto';import {signConditional,URL_FIXED,sha} from '../scripts/lib/backend-conditional-canary.mjs';
test('conditional GET/HEAD signatures match extracted exact c7 data.ts signedRequest',async()=>{
 // Verbatim method fixture from c7e00f72292573dde4c892a2038a65e65d5b7066.
 let method=fs.readFileSync(new URL('./fixtures/c7-signed-request.txt',import.meta.url),'utf8');
 method=method.replace('private async signedRequest(method: string, url: URL, body?: string | Buffer, extraHeaders: Record<string, string> = {}, query = "")','async signedRequest(method, url, body, extraHeaders = {}, query = "")').replace('const headers: Record<string, string>','const headers').replace('let lastError: unknown','let lastError').replace('let response: Response','let response').replace('body as any','body');
 const now=new Date('2026-11-17T12:00:00.000Z'),env={YC_OBJECT_STORAGE_ACCESS_KEY_ID:'offline-access',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'offline-secret',YC_OBJECT_STORAGE_REGION:'us-east-1'};let captured;
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]));}}
 const context={crypto,sha256:sha,hmac:(k,v)=>crypto.createHmac('sha256',k).update(v).digest(),objectConfig:()=>({endpoint:'https://s3.regru.cloud',region:'us-east-1',secretAccessKey:env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,accessKeyId:env.YC_OBJECT_STORAGE_ACCESS_KEY_ID}),process:{env:{}},Date:FixedDate,Buffer,AbortController,setTimeout,clearTimeout,objectStorageRequestTimeoutMs:()=>1000,fetch:async(_url,options)=>{captured=options.headers;return new Response(null,{status:200});},TRANSIENT_STATUS:new Set(),objectStorageResponseBodies:new WeakMap()};
 const exact=vm.runInNewContext('(new (class Exact {'+method+'})())',context);
 for(const method of ['HEAD','GET'])for(const condition of [{},{'if-match':'"strong-etag"'},{'if-match':'W/"strong-etag"'},{'if-none-match':'"strong-etag"'}]){
  await exact.signedRequest(method,new URL(URL_FIXED),undefined,condition);
  assert.deepEqual(JSON.parse(JSON.stringify(captured)),signConditional(method,new URL(URL_FIXED),env,condition,now));
 }
});
