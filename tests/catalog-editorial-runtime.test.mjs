import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {calculationVersion} from '../scripts/catalog-calculation-version.mjs';
import {EDITORIAL_HEALTH_URL,UNSUPPORTED_ACCEPTED_RELEASE,validateEditorialHealth,readEditorialHealth,
 assertEditorialHealth,installedEditorialSupported,editorialPreparationFetch,prepareInstalledEditorial} from '../scripts/catalog-editorial-runtime.mjs';

const sha='a'.repeat(40),calc='b'.repeat(64),health={ok:true,releaseSha:sha,calculationVersion:calc};
const objectEnv={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_BUCKET:'avtocena-staging-8120751',YC_OBJECT_STORAGE_PREFIX:'migration-staging/full-20261011/'};
test('fixed health reader validates a complete bounded response and exact release/calculator',async()=>{
 const actual=await readEditorialHealth(async(url,options)=>{
  assert.equal(url,EDITORIAL_HEALTH_URL);assert.equal(options.redirect,'error');assert.equal(options.headers['cache-control'],'no-cache');
  return new Response(JSON.stringify({...health,ignored:'not returned'}));
 });
 assert.deepEqual(actual,{release:sha,calculationVersion:calc});
 for(const value of [{...health,ok:false},{...health,releaseSha:'bad'},{...health,calculationVersion:null},{...health,calculationVersion:'c'.repeat(63)}])assert.throws(()=>validateEditorialHealth(value),/health_invalid/);
 await assert.rejects(readEditorialHealth(async()=>new Response('{')),/health_json/);
 await assert.rejects(readEditorialHealth(async()=>new Response('redirect',{status:302})),/health_http/);
 await assert.rejects(readEditorialHealth(async()=>new Response(' '.repeat(32769))),/health_capacity/);
 assert.throws(()=>assertEditorialHealth(actual,{...actual,release:'c'.repeat(40)}),/health_changed/);
 assert.throws(()=>assertEditorialHealth(actual,{...actual,calculationVersion:'c'.repeat(64)}),/health_changed/);
});

test('health deadline covers stalled headers and full streamed body',async()=>{
 let aborted=false;
 await assert.rejects(readEditorialHealth(async(_url,{signal})=>{signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});},10),/health_timeout/);
 assert.equal(aborted,true);
 let cancelled=false;
 await assert.rejects(readEditorialHealth(async()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}})),10),/health_timeout/);
 assert.equal(cancelled,true);
});

test('network scope permits only fixed health, configured object reads and exact derivative PUTs',async()=>{
 const calls=[],guard=editorialPreparationFetch(async(input,options)=>{calls.push([String(input),options]);return new Response('{}');},objectEnv,'gen_1_fixture');
 const base='https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/';
 await guard(EDITORIAL_HEALTH_URL);await guard(base+'catalog/manifest.json');
 await guard(base+'catalog/generations/gen_1_fixture/indexes/editorial-home-v1/2026-11-11/'+'a'.repeat(64)+'.json',{method:'PUT'});
 assert.ok(calls.every(([,options])=>options.redirect==='error'));
 for(const [url,method] of [['https://supplier.example/search','GET'],[base+'catalog/manifest.json','PUT'],[base+'catalog/manifest.json','DELETE'],[base+'catalog/manifest.json?x=1','GET'],[base+'../elsewhere/file','GET'],[EDITORIAL_HEALTH_URL+'?x=1','GET'],[EDITORIAL_HEALTH_URL,'POST']]){
  assert.throws(()=>guard(url,{method}),/network_scope_denied/);
 }
 assert.throws(()=>editorialPreparationFetch(fetch,{...objectEnv,YC_OBJECT_STORAGE_ENDPOINT:'https://elsewhere.example'},'gen_1_fixture'),/storage_scope_invalid/);
});

async function fixture(t,{helper=true}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'editorial-runtime-')),priorCwd=process.cwd(),priorEnv={...process.env};
 globalThis.__editorialRuntimeFixtures??=new Map();
 const generationId='gen_1_fixture',values=new Map(),writes=[],events=[];
 const storage={driver:'object',async readJson(key,fallback){events.push(key);return values.has(key)?values.get(key):fallback;},
  async writeJson(key,value,condition){writes.push({key,value,condition});values.set(key,value);}};
 const files={
  'apps/web/lib/data.ts':`export const getJsonStorage=()=>globalThis.__editorialRuntimeFixtures.get(${JSON.stringify(root)}).storage;`,
  'apps/web/lib/encyclopedia/calculation-index.ts':'// private-index loader exists in installed release\n',
  'apps/web/lib/catalog/shared-budget-prices.ts':'// calculation closure marker\n',
  'apps/web/lib/catalog/storage.ts':`export const searchOffers=query=>globalThis.__editorialRuntimeFixtures.get(${JSON.stringify(root)}).search(query);`,
  'scripts/catalog-calculation-version.mjs':await fs.readFile(new URL('../scripts/catalog-calculation-version.mjs',import.meta.url),'utf8'),
 };
 if(helper)files['apps/web/lib/catalog/editorial-home.ts']=`import fs from 'node:fs';
 const indexAtImport=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'data/knowledge/encyclopedia/calculation-v1.json'))},'utf8'));
 export const prepareEditorialHome=args=>{const state=globalThis.__editorialRuntimeFixtures.get(${JSON.stringify(root)});state.indexAtImport=indexAtImport;return state.prepare(args);};`;
 for(const [name,body] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),body);}
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000});
 git(['init','-q']);git(['add','.']);git(['-c','user.name=Offline test','-c','user.email=offline@example.invalid','commit','-qm','fixture']);
 const release=git(['rev-parse','HEAD']).trim(),expected={release,calculationVersion:calculationVersion(root)};
 const models={'bmw:тест':[{power:123.45,title:'試験'}]},digest=createHash('sha256').update(JSON.stringify(models)).digest('hex');
 const index={version:1,digest,models,createdAt:'2026-11-11T00:00:00Z'},indexKey=`knowledge/encyclopedia/calculation-indexes/${digest}.json`,bindingKey=`knowledge/encyclopedia/calculation-releases/${release}.json`;
 values.set('catalog/manifest.json',{generationId,markets:{europe:{count:2}}});
 values.set(bindingKey,{release,digest,key:indexKey});values.set(indexKey,index);
 const state={storage,search:async query=>{assert.deepEqual(query,{market:'europe',pageSize:12,sort:'updatedAt'});return {generationId,total:2,items:[]};},
  prepare:async({storage,search})=>{
   assert.equal(process.env.AVTOCENA_RELEASE_SHA,release);assert.equal(process.env.GITHUB_SHA,release);
   assert.equal(process.env.AVTOCENA_CALCULATION_VERSION,expected.calculationVersion);
   assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'data/knowledge/encyclopedia/calculation-v1.json'),'utf8')),index);
   assert.deepEqual(state.indexAtImport,index,'private index is restored before calculator consumers import');
   await search('europe');
   await storage.writeJson(`catalog/generations/${generationId}/indexes/editorial-home-v1/2026-11-11/${'c'.repeat(64)}.json`,
    {generationId,context:{release,calculationVersion:expected.calculationVersion,encyclopediaDigest:digest}},{ifNoneMatch:'*'});
   return {generationId,prepared:true,policyDate:'2026-11-11',markets:['europe']};
  }};
 globalThis.__editorialRuntimeFixtures.set(root,state);Object.assign(process.env,objectEnv);process.chdir(root);
 t.after(async()=>{process.chdir(priorCwd);for(const key of Object.keys(process.env))if(!(key in priorEnv))delete process.env[key];Object.assign(process.env,priorEnv);globalThis.__editorialRuntimeFixtures.delete(root);await fs.rm(root,{recursive:true,force:true});});
 return {root,expected,generationId,storage,values,writes,events,state,index,bindingKey,indexKey,
  run:(readHealth=async()=>({...expected}))=>prepareInstalledEditorial({root,expected,readHealth}),
  assertClean:()=>assert.rejects(fs.access(path.join(root,'data/knowledge/encyclopedia/calculation-v1.json')),error=>error.code==='ENOENT')};
}

test('exact installed source restores its immutable model digest, prepares only its derivative and removes private file',async t=>{
 const f=await fixture(t);let checks=0;
 const result=await f.run(async()=>{checks++;return {...f.expected};});
 assert.equal(result.supported,true);assert.equal(result.prepared,true);assert.equal(result.encyclopediaDigest,f.index.digest);
 assert.ok(checks>=4);assert.equal(f.writes.length,1);assert.equal(f.values.get('catalog/manifest.json').generationId,f.generationId);
 assert.ok(f.events.includes(f.bindingKey));assert.ok(f.events.includes(f.indexKey));await f.assertClean();
});

test('source checkout and calculator mismatch fail before any restoration or write',async t=>{
 const f=await fixture(t);
 for(const changed of [{...f.expected,release:sha},{...f.expected,calculationVersion:calc}]){
  await assert.rejects(prepareInstalledEditorial({root:f.root,expected:changed,readHealth:async()=>changed}),/editorial_runtime_(checkout|calculation)_mismatch/);
 }
 assert.deepEqual(f.events,[]);assert.deepEqual(f.writes,[]);
});

for(const damaged of ['binding','models','version'])test(`immutable private restoration rejects ${damaged} damage`,async t=>{
 const f=await fixture(t);
 if(damaged==='binding')f.values.set(f.bindingKey,{...f.values.get(f.bindingKey),release:sha});
 if(damaged==='models')f.values.set(f.indexKey,{...f.index,models:{tampered:[]}});
 if(damaged==='version')f.values.set(f.indexKey,{...f.index,version:2});
 await assert.rejects(f.run(),/live_encyclopedia_(binding_missing|index_invalid)/);assert.equal(f.writes.length,0);await f.assertClean();
});

test('only known accepted unsupported release may explicitly skip the helper',async t=>{
 const f=await fixture(t,{helper:false});
 assert.equal(await installedEditorialSupported(f.root,UNSUPPORTED_ACCEPTED_RELEASE),false);
 await assert.rejects(f.run(),/editorial_runtime_helper_missing/);assert.equal(f.writes.length,0);
});

test('health changing after preparation prevents a readiness success',async t=>{
 const f=await fixture(t);let checks=0;
 await assert.rejects(f.run(async()=>++checks>=4?{...f.expected,release:sha}:{...f.expected}),/editorial_runtime_health_changed/);
 assert.equal(f.writes.length,1,'only the old release-scoped derivative may exist');await f.assertClean();
});

test('active publication and changed source pointer fail closed without derivative writes',async t=>{
 const f=await fixture(t);f.values.set('catalog/import-lock.json',{lockedUntil:new Date(Date.now()+60_000).toISOString()});
 await assert.rejects(f.run(),/editorial_runtime_publication_in_progress/);assert.equal(f.events.includes(f.bindingKey),false);
 f.values.delete('catalog/import-lock.json');const prepare=f.state.prepare;
 f.state.prepare=async args=>{f.values.set('catalog/manifest.json',{generationId:'gen_2_changed',markets:{}});return prepare(args);};
 await assert.rejects(f.run(),/editorial_runtime_publication_changed/);assert.equal(f.writes.length,0);await f.assertClean();
});

for(const denied of ['manifest','provider','different-index'])test(`installed helper cannot mutate ${denied} scope`,async t=>{
 const f=await fixture(t);
 f.state.prepare=async({storage})=>{
  if(denied==='manifest')await storage.writeJson('catalog/manifest.json',{},{});
  else if(denied==='different-index')await storage.writeJson(`catalog/generations/${f.generationId}/indexes/editorial-home-v1/2026-11-11/${'c'.repeat(64)}.json`,
   {generationId:f.generationId,context:{release:f.expected.release,calculationVersion:f.expected.calculationVersion,encyclopediaDigest:calc}},{ifNoneMatch:'*'});
  else await fetch('https://supplier.example/search');
 };
 await assert.rejects(f.run(),/editorial_runtime_(write_scope|network_scope)_denied/);assert.equal(f.writes.length,0);await f.assertClean();
});

test('daily workflow preserves schedule/triggers and uses isolated installed source with bounded cleanup',async()=>{
 const workflow=await fs.readFile(new URL('../.github/workflows/regcloud-overview.yml',import.meta.url),'utf8');
 assert.match(workflow,/cron: '5 17 \* \* \*'/);assert.equal((workflow.match(/cron:/g)||[]).length,1);
 for(const market of ['china','korea','europe','uae','georgia','green'])assert.ok(workflow.includes('Catalog refresh '+market));
 assert.match(workflow,/group: regcloud-overview-read-model\n  cancel-in-progress: false/);
 assert.match(workflow,/CATALOG_PREPARE_EDITORIAL_HOME: 'false'/);
 assert.match(workflow,/ref: \$\{\{ steps\.installed\.outputs\.release \}\}/);
 assert.match(workflow,/timeout --signal=TERM --kill-after=10s 300s node --import tsx/);
 assert.match(workflow,/if: always\(\)\n        run: rm -rf -- installed-editorial-runtime/);
 assert.doesNotMatch(workflow,/upload-artifact|ssh|docker (?:run|start|restart)/);
 const builder=await fs.readFile(new URL('../scripts/catalog-refresh-generation-pages.mjs',import.meta.url),'utf8');
 assert.match(builder,/if\(process\.env\.CATALOG_PREPARE_EDITORIAL_HOME!=='false'\)/);
 const preparation=await fs.readFile(new URL('../scripts/encyclopedia/prepare-calculation-index.mjs',import.meta.url),'utf8');
 assert.match(preparation,/if\(old&&old\.digest!==index\.digest\)throw Error\('release_encyclopedia_binding_changed'\)/);
 const ci=await fs.readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/node --import tsx --import \.\/tests\/helpers\/offline-fetch\.mjs --test tests\/catalog-editorial-runtime\.test\.mjs/);
});
