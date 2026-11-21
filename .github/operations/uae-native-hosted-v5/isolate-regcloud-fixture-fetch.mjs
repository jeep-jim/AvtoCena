// Browser QA only. Install as Node preload in the isolated fixture process.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert.equal(process.env.JSON_STORAGE_DRIVER,'object');
assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT,'https://s3.regru.cloud');
assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET,'fixture-uae');
assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX,'fixture-uae');
assert.equal(process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID,'fixture');
assert.equal(process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY,'fixture');
const path=process.env.UAE_FIXTURE_STORAGE_PACKAGE;
const st=lstatSync(path);
assert.ok(st.isFile()&&st.size>0&&st.size<=12*1024*1024&&(st.mode&0o077)===0);
const raw=readFileSync(path);
const sha=data=>createHash('sha256').update(data).digest('hex');
assert.equal(sha(raw),process.env.UAE_FIXTURE_STORAGE_SHA256);
const packageData=JSON.parse(raw);
assert.equal(packageData.kind,'uae-browser-mock-storage-v1');
assert.ok(packageData.objects&&typeof packageData.objects==='object'&&!Array.isArray(packageData.objects));
const known=new Map();
for(const [key,entry] of Object.entries(packageData.objects)){
 assert.ok(key.split('/').every(segment=>/^[a-zA-Z0-9._-]+$/.test(segment)&&segment!=='.'&&segment!=='..'));
 assert.ok(entry&&typeof entry.body==='string'&&typeof entry.sha256==='string');
 const body=Buffer.from(entry.body,'base64');
 assert.ok(body.length<=4*1024*1024&&sha(body)===entry.sha256);
 known.set('/fixture-uae/fixture-uae/'+key,{body,etag:'"'+entry.sha256+'"'});
}
globalThis.fetch=async (input,init={})=>{
 const url=new URL(input instanceof Request?input.url:String(input)),method=init.method||(input instanceof Request?input.method:'GET');
 const headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));
 if(url.origin!=='https://s3.regru.cloud'||url.search||!['GET','HEAD'].includes(method)||!headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 Credential=fixture/'))
  throw Error('uae_fixture_forbidden_fetch');
 const object=known.get(decodeURIComponent(url.pathname));
 if(!object)return new Response(null,{status:404});
 if(headers.get('if-none-match')===object.etag)return new Response(null,{status:304,headers:{etag:object.etag}});
 return new Response(method==='HEAD'?null:object.body,{headers:{etag:object.etag,'content-type':'application/json'}});
};
