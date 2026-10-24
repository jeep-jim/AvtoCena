import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {writeCatalogProjectionBatches, writeCatalogProjectionParts, readCatalogProjectionParts, catalogProjectionBatches, PROJECTION_BYTES_PER_PART} from '../apps/web/lib/catalog-projection-parts';
import type {JsonStorage} from '../apps/web/lib/data';

function backend() {
  const values = new Map<string, any>();
  const writes: string[] = [];
  const storage = {
    driver: 'local',
    async writeJson(key:string, value:unknown, condition?:any) {
      if (condition?.ifNoneMatch && values.has(key)) throw Error('storage_conflict');
      if (condition?.ifMatch) throw Error('storage_conflict');
      // Every physical part is a bounded JSON object, including UTF-8 text.
      const text = JSON.stringify(value);
      if (key.includes('/projection-parts/')) assert.ok(Buffer.byteLength(text) <= PROJECTION_BYTES_PER_PART);
      values.set(key, JSON.parse(text)); writes.push(key);
    },
    async readJson(key:string, fallback:unknown) { return values.get(key) ?? fallback; },
  } as JsonStorage;
  return {storage, values, writes};
}

test('public and immutable market/brand projections use isolated bounded parts', async () => {
  const {storage, values} = backend();
  const keys = ['catalog/public/projection/all.json','catalog/public/projection/china.json','catalog/public/projection-brand/toyota-123.json','catalog/generations/gen1/indexes/projection/china.json','catalog/generations/gen1/indexes/projection-brand/toyota-123.json'];
  for (const [scope,key] of keys.entries()) {
    const rows = Array.from({length:2301}, (_,i)=>({id:`${scope}-${i}`,value:'Автомобиль 北京',nested:{unknown:null}}));
    const directory = await writeCatalogProjectionBatches(storage,key,'gen1',[rows.slice(0,500),rows.slice(500)]);
    assert.equal(directory.parts.length,3);
    assert.deepEqual(await readCatalogProjectionParts(storage,key,values.get(key)),{generationId:'gen1',items:rows});
    const corrupted = {...directory,parts:[{...directory.parts[0],path:'catalog/public/projection/china.json'}]};
    await assert.rejects(async()=>{for await(const _ of catalogProjectionBatches(storage,key,corrupted)){}},/descriptor_invalid/);
  }
  const paths = keys.flatMap(key=>values.get(key).parts.map((part:any)=>part.path));
  assert.equal(new Set(paths).size,paths.length);
});

test('large Unicode rows split by bytes before the row limit, without truncation', async () => {
  const {storage,values} = backend(), key='catalog/public/projection/china.json';
  const rows=Array.from({length:11},(_,i)=>({id:i,text:'я'.repeat(300_000)}));
  const result=await writeCatalogProjectionBatches(storage,key,'bytes',[rows]);
  assert.equal(result.parts.length,2);
  assert.deepEqual(await readCatalogProjectionParts(storage,key,values.get(key)),{generationId:'bytes',items:rows});
  const before=values.get(key);
  await assert.rejects(writeCatalogProjectionBatches(storage,key,'oversize',[[{text:'x'.repeat(PROJECTION_BYTES_PER_PART)}]]),/row_too_large/);
  assert.equal(values.get(key),before);
});

test('async input is backpressured and a failed later batch preserves the active root', async () => {
  const {storage,values,writes}=backend(),key='catalog/public/projection/all.json';
  const old={generationId:'old',items:[{id:'old'}]};values.set(key,old);
  async function* input() {
    yield Array.from({length:1001},(_,id)=>({id}));
    assert.ok(writes.some(path=>path.includes('/projection-parts/')),'write before next input');
    throw Error('source_failed');
  }
  await assert.rejects(writeCatalogProjectionBatches(storage,key,'new',input()),/source_failed/);
  assert.equal(values.get(key),old);
});

test('scoped root writes are separately gated for installed reader compatibility', async () => {
  const before=process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE;
  try {
    const {storage}=backend(), value={generationId:'gen',items:[{id:'1'}]}, key='catalog/public/projection/china.json';
    delete process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE;
    assert.equal(await writeCatalogProjectionParts(storage,key,value),false);
    process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE='1';
    assert.equal(await writeCatalogProjectionParts(storage,key,value),true);
    assert.equal(await writeCatalogProjectionParts(storage,'settings/site-business.json',value),false);
  } finally {
    if(before===undefined)delete process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE;else process.env.CATALOG_CHUNKED_PROJECTIONS_WRITE=before;
  }
});

test('existing all-market directories remain readable with exact legacy paths', async () => {
  const {storage,values}=backend(), part={items:[{id:'legacy'}]};
  const sha256=crypto.createHash('sha256').update(JSON.stringify(part)).digest('hex');
  const path=`catalog/generations/legacy/indexes/projection-parts/all/0-${sha256}.json`;
  values.set(path,part);
  const value={storageFormat:'catalog-projection-parts-v1',generationId:'legacy',count:1,parts:[{path,count:1,sha256}]};
  assert.deepEqual(await readCatalogProjectionParts(storage,'catalog/public/projection/all.json',value),{generationId:'legacy',items:part.items});
});
