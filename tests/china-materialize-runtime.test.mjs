import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {materializeChinaRuntimeContext} from '../scripts/catalog-china-materialize-runtime.mjs';
const hash=x=>createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
async function fixture(t,{change=false,wrongBinding=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'china-readonly-context-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const rep=path.join(root,'repo'),dir=path.join(rep,'data/catalog/vehicle-knowledge');await fs.mkdir(dir,{recursive:true});
 const git=async(...argv)=>(await promisify(execFile)('git',argv,{cwd:rep})).stdout.trim();
 await git('init','-q');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.test');
 const models=[{id:'bmw-x3',make:'BMW',model:'X3',aliases:['X 3']}];
 await fs.writeFile(path.join(dir,'models-index.json'),JSON.stringify({version:1,total:1,chunks:[{file:'models-0001.json',count:1}]}));
 await fs.writeFile(path.join(dir,'models-0001.json'),JSON.stringify(models));
 await fs.writeFile(path.join(dir,'v2-bridge-models.json'),'[]');
 await git('add','.');await git('commit','-qm','fixture release');
 const releaseSha=await git('rev-parse','HEAD');
 // Mutable worktree bytes are deliberately not bundled.
 await fs.writeFile(path.join(dir,'models-0001.json'),JSON.stringify([{make:'WRONG'}]));
 const records={'bmw:x3':[{make:'BMW',model:'X3'}]},digest=hash(records),index={version:1,digest,models:records};
 const binding='knowledge/encyclopedia/calculation-releases/'+releaseSha+'.json',key='knowledge/encyclopedia/calculation-indexes/'+digest+'.json';
 const mutable='markets/markets.json',anchor='catalog/china-cny-prices/current.json';
 const content={
  [binding]:{release:wrongBinding?'b'.repeat(40):releaseSha,key,digest},
  [key]:index,[mutable]:[{id:'china',activeVersionId:'x',versions:[{id:'x',active:true}]}],
  'fees/exchange-rates.json':{rates:['CNY','USD','EUR'].map(currency=>({currency,rateSource:'cbr',cbrRate:10,nominal:1,rateDate:'2026-11-20'}))},
  'catalog-editorial/current.json':{version:1,entries:{k:{market:'korea'}}},
 };
 const activity=[],checks=new Map();
 const credentials={access:'fixture-existing-reg',secret:'fixture-existing-local-secret'};
 const fetchImpl=async(u,init)=>{
  const target=new URL(u);assert.equal(target.origin,'https://s3.regru.cloud');assert.equal(init.redirect,'error');
  const pre='/avtocena-staging-8120751/migration-staging/full-20261011/';
  assert.ok(target.pathname.startsWith(pre));const k=target.pathname.slice(pre.length);
  assert.ok(k in content||k===anchor,k);assert.ok(['HEAD','GET'].includes(init.method));assert.match(init.headers.authorization,/^AWS4-HMAC-SHA256 Credential=fixture-existing-reg\//);
  activity.push({key:k,method:init.method});
  if(k===anchor)return new Response(null,{status:404});
  checks.set(k,(checks.get(k)??0)+1);
  const raw=Buffer.from(JSON.stringify(content[k])),bytes=k===key?gzipSync(raw):raw;
  const etag='"'+(change&&checks.get(k)===3&&k===mutable?'moved':hash(bytes))+'"';
  return new Response(init.method==='HEAD'?null:new Uint8Array(bytes),{status:200,headers:{etag,'content-length':String(bytes.length),
    ...(k===key?{'content-encoding':'gzip'}:{})}});
 };
 const out=path.join(root,'avtocena-china-context-fixture');
 const plan={version:1,kind:'china-regcloud-readonly-runtime-context-v1',market:'china',releaseSha,calculationVersion:'1'.repeat(64),
  expectedIndexDigest:digest,allowAbsent:[anchor],storage:{endpoint:'https://s3.regru.cloud',bucket:'avtocena-staging-8120751',prefix:'migration-staging/full-20261011',region:'us-east-1'},
  remoteWritesAuthorized:false,publicationAuthorized:false};
 return {args:{plan,expectedPlanSha256:hash(plan),releaseRoot:rep,out,credentials,fetchImpl},activity,models,index,out,key};
}
test('read-only SigV4 materializes exact mutable snapshot, release Git model chunks and private bound encyclopedia',async t=>{
 const f=await fixture(t);
 const result=await materializeChinaRuntimeContext(f.args);
 assert.equal(result.receipt.storageWrites,0);
 const model=JSON.parse(await fs.readFile(path.join(f.out,'data/catalog/vehicle-knowledge/models-0001.json'),'utf8'));
 assert.deepEqual(model,f.models);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.out,'data/knowledge/encyclopedia/calculation-v1.json'),'utf8')),f.index);
 assert.equal(hash(await fs.readFile(path.join(f.out,'RUNTIME_CONTEXT.json'))),result.receiptSha256);
 assert.ok(result.receipt.objects.some(x=>x.absent===true));
 assert.ok(f.activity.every(x=>['HEAD','GET'].includes(x.method)));
 assert.ok(!f.activity.some(x=>x.key==='catalog/manifest.json'));
});
test('a late ETag change or a forged release binding cannot produce a context',async t=>{
 for(const option of [{change:true},{wrongBinding:true}]){
  const f=await fixture(t,option);
  await assert.rejects(materializeChinaRuntimeContext(f.args),option.change?/input_snapshot_changed/:/encyclopedia_release_binding/);
  await assert.rejects(fs.stat(f.out),{code:'ENOENT'});
 }
});
