import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
test('saved China materializer uses the external controller with fresh resources and exact source arguments',async()=>{
 const {ownedChinaMaterializationInvocation}=await import('../scripts/catalog-prepare-owned-china.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-china-source-'));
 try{
  await fs.mkdir(path.join(root,'scripts'));
  await fs.symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),path.join(root,'node_modules'),'dir');
  await fs.writeFile(path.join(root,'scripts/catalog-auto-api-che168-bulk-intake.mjs'),`
   import v8 from 'node:v8';
   console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),heap:v8.getHeapStatistics().heap_size_limit,
    cut:process.env.OWNED_CHINA_CUT,replica:process.env.AUTO_API_CHE168_REQUIRE_REPLICA,
    output:process.env.AUTO_API_INTAKE_DIR,nodeOptions:process.env.NODE_OPTIONS}));
   if(process.env.TEST_CHILD_EXIT)process.exitCode=Number(process.env.TEST_CHILD_EXIT);
  `);
  const directory=path.join(root,'saved intake'),cutRunId='45067305608';
  const invocation=ownedChinaMaterializationInvocation({root,directory,cutRunId,
   env:{...process.env,NODE_OPTIONS:'--max-old-space-size=64 --no-warnings',OWNED_CHINA_CUT:'foreign',AUTO_API_CHE168_REQUIRE_REPLICA:'0'}});
  assert.equal(path.isAbsolute(invocation.args[0]),true);
  assert.equal(invocation.args[0],fileURLToPath(new URL('../scripts/run-node-with-resources.mjs',import.meta.url)));
  assert.deepEqual(invocation.args.slice(1),['--import','tsx','scripts/catalog-auto-api-che168-bulk-intake.mjs']);
  const result=await execute(invocation.command,invocation.args,{...invocation.options,stdio:undefined});
  const actual=JSON.parse(result.stdout),events=result.stderr.split('\n').flatMap(line=>{
   try{const row=JSON.parse(line);return row.stage==='node_resource_memory'?[row]:[];}catch{return [];}
  });
  assert.equal(actual.cwd,root);assert.deepEqual(actual.args,[]);
  assert.equal(actual.cut,cutRunId);assert.equal(actual.replica,'1');assert.equal(actual.output,directory);
  assert.match(actual.nodeOptions,/--no-warnings/);assert.doesNotMatch(actual.nodeOptions,/max[-_]old[-_]space[-_]size/);
  assert.equal(events.length,1);assert.ok(events[0].availableRamBytes>0);
  assert.equal(actual.heap,events[0].actualHeapBytes);assert.equal(actual.heap,events[0].requestedHeapBytes);
  assert.ok(actual.heap>64*1024*1024);
  await assert.rejects(execute(invocation.command,invocation.args,{...invocation.options,stdio:undefined,
   env:{...invocation.options.env,TEST_CHILD_EXIT:'23'}}),error=>error.code===23);
  assert.deepEqual((await fs.readdir(path.join(root,'scripts'))).sort(),['catalog-auto-api-che168-bulk-intake.mjs']);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('automatic feed maintenance launches heavy work through the reviewed resource controller',async()=>{
 const scripts={
  'catalog-che168-verify-publication.yml':['catalog-verify-owned-china','catalog-verify-che168-publication','catalog-audit-visible-calculation-coverage'],
  'catalog-refresh-green.yml':['catalog-refresh-green-corner'],
  'catalog-overview-read-model.yml':['catalog-build-overview-read-model'],
  'catalog-current-read-models.yml':['catalog-publish-current-read-models'],
  'catalog-storage-cleanup.yml':['catalog-storage-maintenance'],
  'catalog-translate-descriptions.yml':['catalog-translate-descriptions'],
  'regcloud-overview.yml':['catalog-refresh-generation-pages'],
 };
 for(const [file,targets] of Object.entries(scripts)){
  const workflow=await fs.readFile(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/NODE_OPTIONS\s*:|max[-_]old[-_]space[-_]size/);
  for(const target of targets)assert.ok(workflow.includes('node scripts/run-node-with-resources.mjs --import tsx scripts/'+target+'.mjs'),file+': '+target);
 }
 const overview=await fs.readFile(new URL('../.github/workflows/regcloud-overview.yml',import.meta.url),'utf8');
 assert.ok(overview.includes("node ../scripts/run-node-with-resources.mjs --import tsx ../scripts/catalog-editorial-runtime.mjs . '${{ steps.installed.outputs.release }}' '${{ steps.installed.outputs.calculation }}'"));
 assert.match(overview,/working-directory: installed-editorial-runtime/);
 assert.match(overview,/ref: \$\{\{ steps\.installed\.outputs\.release \}\}/);
});
