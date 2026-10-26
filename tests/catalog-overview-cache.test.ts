import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { readCatalogOverview, resetCatalogOverviewCache } from '../apps/web/lib/catalog/overview';

test('overview coalesces concurrent reads, follows generation changes and retries failures', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const reads: string[] = [];
  let fail = false;
  storage.readJsonWithMeta = async <T>(key: string) => {
    reads.push(key);
    if (fail) throw Error('temporary storage failure');
    const generationId = key.split('/')[2];
    return {found: true, value: {version: 1, publicPolicyVersion: 2, generationId,
      policyDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10), facets: {generationId}, markets: {}} as T};
  };
  resetCatalogOverviewCache();
  try {
    const results = await Promise.all(Array.from({length: 8}, () => readCatalogOverview('g1')));
    assert.equal(reads.length, 1);
    assert.ok(results.every(result => result?.generationId === 'g1'));
    assert.equal((await readCatalogOverview('g2'))?.generationId, 'g2');
    assert.equal(reads.length, 2);
    fail = true;
    await assert.rejects(readCatalogOverview('g3'), /temporary storage failure/);
    fail = false;
    assert.equal((await readCatalogOverview('g3'))?.generationId, 'g3');
    assert.equal(reads.length, 4);
  } finally {storage.readJsonWithMeta = original; resetCatalogOverviewCache();}
});

test('a stale legacy overview is not accepted or retained as a failed cache entry', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  let legacyGeneration = 'old';
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => ({found: true,
    value: key.includes('/generations/') ? fallback : {version: 1, publicPolicyVersion: 2,
      policyDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10), generationId: legacyGeneration, facets: {generationId: legacyGeneration}, markets: {}} as T});
  resetCatalogOverviewCache();
  try {
    assert.equal(await readCatalogOverview('current'), null);
    legacyGeneration = 'current';
    assert.equal((await readCatalogOverview('current'))?.generationId, 'current');
  } finally {storage.readJsonWithMeta = original; resetCatalogOverviewCache();}
});

test('midnight selects the exact dated overview before the cache TTL expires',async(t)=>{
 const storage=getJsonStorage(),reads:string[]=[];
 let now=Date.parse('2026-10-26T16:59:59Z');t.mock.method(Date,'now',()=>now);
 const overview=(day:string,total:number)=>({version:1,publicPolicyVersion:2,generationId:'g',policyDate:day,
  facets:{generationId:'g'},markets:{korea:{total,items:[]}}});
 t.mock.method(storage,'readJsonWithMeta',async(key:string)=>{
  reads.push(key);return {found:true,value:key.endsWith('.2026-10-27.json')?overview('2026-10-27',9):overview('2026-10-26',10)};
 });
 resetCatalogOverviewCache();
 try{
  assert.equal((await readCatalogOverview('g'))?.markets.korea.total,10);
  now+=2000;
  assert.equal((await readCatalogOverview('g'))?.markets.korea.total,9);
  assert.equal(reads.length,3);
 }finally{resetCatalogOverviewCache();t.mock.restoreAll();}
});

test('expired base and alias cannot substitute for a missing current-day derivative',async(t)=>{
 const storage=getJsonStorage();
 t.mock.method(storage,'readJsonWithMeta',async()=>({found:true,value:{version:1,publicPolicyVersion:2,
  generationId:'g',policyDate:'2000-01-01',facets:{generationId:'g'},markets:{}}}));
 resetCatalogOverviewCache();
 try{assert.equal(await readCatalogOverview('g'),null);}
 finally{resetCatalogOverviewCache();t.mock.restoreAll();}
});
