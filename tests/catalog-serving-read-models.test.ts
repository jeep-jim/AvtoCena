import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServingPublicationReadModelBuilders, writeServingProjectionRows, readServingProjectionRows,
  assertServingReadModelContext} from '../scripts/lib/catalog-serving-read-models.mjs';
import {buildServingReadModel} from '../scripts/catalog-serving-read-model-child.mjs';
import {assertStagedRuntimeSource} from '../scripts/lib/catalog-staged-budget.mjs';

async function temp(t:any) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'serving-model-test-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  return root;
}
async function rows(file:string, expected?:{rows:number;bytes:number;sha256:string}) {
  const result:any[] = [];
  for await (const row of readServingProjectionRows(file, expected)) result.push(row);
  return result;
}

test('streamed budget uses bounded batches, rejects foreign identities and verifies complete input', async t => {
  const root = await temp(t), input = path.join(root,'input.jsonl'), output = path.join(root,'output.jsonl');
  const source = Array.from({length:501}, (_, i) => ({id:'row-'+i, market:'europe', year:2021}));
  const inputReceipt = await writeServingProjectionRows(input, source);
  const batches:number[] = [];
  const catalog = {prepareCatalogProjectionRows:async (values:any[]) => { batches.push(values.length); return values; }};
  const report = await buildServingReadModel({catalog, request:{task:'budget',input,inputReceipt,output,rows:501}});
  assert.equal(report.inputRows,501); assert.equal(report.output.rows,501);
  assert.deepEqual(batches,[500,1]); assert.deepEqual(await rows(output, report.output),source);
  await assert.rejects(buildServingReadModel({catalog:{prepareCatalogProjectionRows:() => [{id:'foreign',market:'europe'}]},
    request:{task:'budget',input,inputReceipt,output:path.join(root,'foreign.jsonl'),rows:501}}), /budget_identity_invalid/);
  await assert.rejects(buildServingReadModel({catalog,
    request:{task:'budget',input,inputReceipt,output:path.join(root,'incomplete.jsonl'),rows:502}}), /input_incomplete/);
});

test('budget cannot cross a policy day and dated builders must return their requested generation', async t => {
  const root = await temp(t), input = path.join(root,'input.jsonl');
  const inputReceipt = await writeServingProjectionRows(input,[{id:'one',market:'korea'}]);
  const times = [new Date('2026-11-22T16:59:59Z'),new Date('2026-11-22T17:00:00Z')];
  await assert.rejects(buildServingReadModel({catalog:{prepareCatalogProjectionRows:(r:any[])=>r},
    request:{task:'budget',input,inputReceipt,output:path.join(root,'day.jsonl'),rows:1},now:()=>times.shift()}),/policy_day_changed/);
  await assert.rejects(buildServingReadModel({catalog:{buildCatalogOverviewFromProjections:()=>({generationId:'wrong'})},
    request:{task:'overview',input,inputReceipt,output:path.join(root,'wrong.json'),rows:1,
      generationId:'gen_1790000000000_abc12345',now:'2026-11-22T12:00:00Z'}}),/result_invalid/);
});

test('JSONL roundtrip streams multibyte records across buffers and binds exact bytes and rows', async t => {
  const root = await temp(t), input = path.join(root,'unicode.jsonl');
  const payload = 'Авто🙂'.repeat(12_000), total = 37;
  async function* source() {
    for (let i=0;i<total;i++) yield {id:'row-'+i,market:'korea',payload};
  }
  const receipt = await writeServingProjectionRows(input, source());
  assert.equal(receipt.rows,total);
  assert.equal(receipt.bytes,(await fs.stat(input)).size);
  assert.ok(receipt.bytes > 4*1024**2,'fixture crosses writer buffers and many reader chunks');
  let read = 0;
  for await (const row of readServingProjectionRows(input, receipt)) {
    assert.deepEqual(row,{id:'row-'+read,market:'korea',payload}); read++;
  }
  assert.equal(read,total);
  await assert.rejects(rows(input,{...receipt,rows:total+1}),/input_incomplete/);
  await assert.rejects(rows(input,{...receipt,rows:total-1}),/input_incomplete/);
  await assert.rejects(rows(input,{...receipt,bytes:receipt.bytes+1}),/transfer_changed/);
  await assert.rejects(rows(input,{...receipt,sha256:'0'.repeat(64)}),/transfer_changed/);
});

test('input and prepared-output corruption cannot be accepted with their original receipt', async t => {
  const root = await temp(t), input = path.join(root,'input.jsonl'), output = path.join(root,'output.jsonl');
  const source = [{id:'one',market:'europe',year:2022},{id:'two',market:'europe',year:2019}];
  const inputReceipt = await writeServingProjectionRows(input,source);
  const catalog = {prepareCatalogProjectionRows:(values:any[])=>values.filter(row=>row.year>=2022)};
  const request = {task:'budget',input,inputReceipt,output,rows:source.length};
  const report = await buildServingReadModel({catalog,request});
  assert.equal(report.inputRows,2); assert.equal(report.output.rows,1,'serving admission may exclude a source row');
  assert.deepEqual(await rows(output,report.output),[source[0]]);
  const original = await fs.readFile(output,'utf8');
  await fs.writeFile(output,original.replace('one','six'));
  await assert.rejects(rows(output,report.output),/transfer_changed/,'same-length valid JSON substitution');
  await fs.writeFile(output,'');
  await assert.rejects(rows(output,report.output),/input_incomplete/,'missing prepared rows');
  await fs.writeFile(input,(await fs.readFile(input,'utf8')).replace('one','six'));
  await assert.rejects(buildServingReadModel({catalog,request:{...request,output:path.join(root,'changed.jsonl')}}),
    /transfer_changed/,'input hash is checked before a successful child receipt');
});

test('malformed, unterminated and oversized individual JSONL rows still fail', async t => {
  const root = await temp(t), input = path.join(root,'malformed.jsonl');
  for (const [content,code] of [
    ['{"id":"one"}',/input_truncated/],
    ['{"id":\n',/row_invalid/],
    ['\n',/row_invalid/],
    ['null\n',/row_invalid/],
    ['[]\n',/row_invalid/],
    [Buffer.from([123,34,120,34,58,34,255,34,125,10]),/row_invalid/],
    [' '.repeat(4*1024**2),/line_bound/],
  ] as const) {
    await fs.writeFile(input,content);
    await assert.rejects(rows(input),code);
  }
  await assert.rejects(writeServingProjectionRows(path.join(root,'large.jsonl'),
    [{id:'large',payload:'x'.repeat(4*1024**2)}]),/line_bound/);
  const empty = path.join(root,'empty.jsonl'), receipt = await writeServingProjectionRows(empty,[]);
  assert.deepEqual(await rows(empty,receipt),[]);
  assert.equal(receipt.sha256,createHash('sha256').update('').digest('hex'));
});

test('exact checkout builders resolve their own cwd and encyclopedia without storage or network', async t => {
  const root = await temp(t), codeRoot = path.join(root,'runtime'), calculationVersion = 'b'.repeat(64);
  const files:Record<string,string> = {
    '.gitignore':'node_modules\ndata/knowledge/\n',
    'data/policy.json':JSON.stringify({minimumYear:2020}),
    'scripts/catalog-calculation-version.mjs':"export const calculationVersion = () => '" + calculationVersion + "';",
    'apps/web/lib/data.ts':"const storage={}; export const getJsonStorage=()=>storage;",
    'apps/web/lib/encyclopedia/calculation-index.ts':
      "import fs from 'node:fs'; export const readCalculationIndex=()=>JSON.parse(fs.readFileSync('data/knowledge/encyclopedia/calculation-v1.json','utf8'));",
    'apps/web/lib/catalog/storage.ts':[
      "import fs from 'node:fs'; import {getJsonStorage} from '../data.ts';",
      "const minimumYear=JSON.parse(fs.readFileSync('data/policy.json','utf8')).minimumYear;",
      "export async function prepareCatalogProjectionRows(rows){",
      "if(rows[0]?.network)await fetch('https://supplier.invalid/private');",
      "if(rows[0]?.storage)await getJsonStorage().writeJson('catalog/manifest.json',{});",
      "return rows.filter(r=>r.year>=minimumYear);}",
      "const day=d=>new Date(d.getTime()+7*3600000).toISOString().slice(0,10);",
      "export async function buildCatalogMarketLanding(g,m,r,o){return {generationId:g,market:m,sourceTotal:r.length,policyDate:day(o.now),minimumYear};}",
      "export async function buildCatalogOverviewFromProjections(g,r,o){return {generationId:g,policyDate:day(o.now),minimumYear};}",
    ].join('\n'),
  };
  for (const [file, value] of Object.entries(files)) {
    const target=path.join(codeRoot,file); await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,value);
  }
  await fs.symlink(path.resolve('node_modules'),path.join(codeRoot,'node_modules'),'dir');
  const git = (args:string[]) => execFileSync('git',args,{cwd:codeRoot,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init','-q']);git(['add','.']);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture']);
  const release=git(['rev-parse','HEAD']), models={};
  const digest=createHash('sha256').update(JSON.stringify(models)).digest('hex');
  const index={version:1,digest,models};
  const storage={driver:'object',readJson:async (key:string) => {
    if(key==='knowledge/encyclopedia/calculation-releases/'+release+'.json')return {release,digest,key:'knowledge/encyclopedia/calculation-indexes/'+digest+'.json'};
    if(key==='knowledge/encyclopedia/calculation-indexes/'+digest+'.json')return index;
    throw Error('fixture_unexpected_read');
  }};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    assert.equal(String(input),'https://avtocena.com/api/health');
    return Response.json({ok:true,releaseSha:release,calculationVersion});
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const make=()=>createServingPublicationReadModelBuilders({storage,runtimeRoot:codeRoot,release});
  const builders=await make();
  try {
    const source=[{id:'old',market:'europe',year:2021},{id:'too-old',market:'europe',year:2019}];
    const [selected,landing,overview]=await Promise.all([
      builders.prepareBudgetRows(source),
      builders.buildLanding('gen_1790000000000_abc12345','europe',source,{now:new Date('2026-11-23T10:00:00Z')}),
      builders.buildOverview('gen_1790000000000_abc12345',source,{now:new Date('2026-11-24T10:00:00Z')}),
    ]);
    assert.deepEqual(selected,[source[0]]);
    assert.equal(landing.minimumYear,2020); assert.equal(landing.policyDate,'2026-11-23');
    assert.equal(overview.policyDate,'2026-11-24');
    await assert.rejects(builders.prepareBudgetRows([{id:'n',market:'korea',year:2022,network:true}]),/network_forbidden/);
    await assert.rejects(builders.prepareBudgetRows(source),/network_forbidden/,'failed queue cannot silently fall back');
  } finally { await builders.dispose(); }
  await assert.rejects(builders.prepareBudgetRows([]),/builder_closed/);
  const blocked=await make();
  try {await assert.rejects(blocked.prepareBudgetRows([{id:'s',market:'korea',year:2022,storage:true}]),/storage_forbidden/);}
  finally {await blocked.dispose();}
  const changed=await make();
  await fs.appendFile(path.join(codeRoot,'apps/web/lib/catalog/storage.ts'),'\n// changed');
  try {await assert.rejects(changed.prepareBudgetRows([{id:'s',market:'korea',year:2022}]),/source_changed/);}
  finally {await changed.dispose();}
  assert.throws(()=>assertStagedRuntimeSource(codeRoot,release),/source_changed/);
  assert.throws(()=>assertStagedRuntimeSource(codeRoot,'c'.repeat(40)),/source_changed/);
});

test('malformed exact-runtime context cannot start a builder', () => {
  for(const value of [null,{}, {version:1,release:'a'.repeat(40),calculationVersion:'b'.repeat(64),encyclopediaDigest:'invalid'}]) {
    assert.throws(()=>assertServingReadModelContext(value),/context_invalid/);
  }
});
