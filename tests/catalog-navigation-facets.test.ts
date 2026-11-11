import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCatalogNavigationFacets, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('navigation survives hidden offers without entering search, budget or projection queues', async t => {
  const generationId = 'navigation-current', reads: string[] = [];
  const facets = {generationId, makes: ['BMW', 'Toyota'], models: [{make:'BMW',model:'3 Series'},{make:'Toyota',model:'Corolla'}],
    markets:['china','europe'],bodyTypes:['sedan'],fuels:['petrol'],transmissions:['automatic'],drives:['rwd']};
  const values = new Map<string, any>([
    ['catalog/manifest.json', {generationId,markets:{europe:{count:2}}}],
    ['catalog/public/facets.json', facets],
    ['catalog/public/brand-summary.json', {generationId,brands:{
      bmw:{make:'BMW',marketCounts:{europe:2},models:[{model:'3 Series',marketCounts:{europe:2}}]},
      toyota:{make:'Toyota',marketCounts:{china:1},models:[{model:'Corolla',marketCounts:{china:1}}]},
    }}],
    ['catalog-editorial/current.json', {revision:'hidden-revision',entries:{
      hidden:{id:'hidden',status:'hidden',market:'europe',make:'BMW',model:'3 Series'},
      visible:{id:'visible',status:'visible',market:'europe',specifications:{drive:'awd'}},
    }}],
  ]);
  const before=JSON.stringify([...values]);
  t.mock.method(getJsonStorage(), 'readJsonWithMeta', async (path: string) => {
    reads.push(path);
    assert.ok(values.has(path), `navigation attempted a heavy or unrelated read: ${path}`);
    return {found:true,value:values.get(path)};
  });
  try {
    resetCatalogReadCachesForTests();
    const [europe, all] = await Promise.all([readCatalogNavigationFacets('europe'),readCatalogNavigationFacets()]);
    assert.deepEqual(europe.makes,['BMW']);
    assert.deepEqual(europe.models,[{make:'BMW',model:'3 Series'}]);
    assert.deepEqual(europe.drives,['awd','rwd']);
    assert.deepEqual(all.makes,['BMW','Toyota']);
    assert.equal(reads.some(path => /projection|budget|offers/.test(path)),false);
    assert.equal(JSON.stringify([...values]),before,'navigation must not alter moderation or published facets');
  } finally { t.mock.restoreAll(); resetCatalogReadCachesForTests(); }
});

test('navigation fences publication races and coalesces the immutable directory fallback', async t => {
  const generationId='navigation-race';
  const facets={generationId,makes:['BMW'],models:[{make:'BMW',model:'3 Series'}],markets:['europe'],bodyTypes:[],fuels:[],transmissions:[],drives:[]};
  let fallbackReads=0, currentUnavailable=false, stored:any=facets;
  t.mock.method(getJsonStorage(), 'readJsonWithMeta', async (path: string) => {
    if(path==='catalog-editorial/current.json')return {found:true,value:{revision:'0',entries:{}}};
    if(path==='catalog/manifest.json')return {found:true,value:{generationId}};
    if(path==='catalog/public/facets.json'){
      if(currentUnavailable)throw Error('storage_read_failed');
      return {found:true,value:{...facets,generationId:'next-unpublished'}};
    }
    if(path===`catalog/generations/${generationId}/indexes/facets.json`){fallbackReads++;return {found:true,value:stored};}
    throw Error(`Unexpected read ${path}`);
  });
  try {
    resetCatalogReadCachesForTests();
    const results=await Promise.all(Array.from({length:8},()=>readCatalogNavigationFacets()));
    assert.equal(fallbackReads,1);
    assert.ok(results.every(result=>result.generationId===generationId));
    currentUnavailable=true;resetCatalogReadCachesForTests();
    assert.equal((await readCatalogNavigationFacets()).generationId,generationId);
    stored={...facets,generationId:'previous'};resetCatalogReadCachesForTests();
    await assert.rejects(readCatalogNavigationFacets(),/catalog_navigation_directory_unavailable/);
  } finally { t.mock.restoreAll(); resetCatalogReadCachesForTests(); }
});
