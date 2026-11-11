import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCatalogNavigationFacets, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';

test('navigation overlaps raw facets with editorial I/O and retains the current market overlay', async t => {
  const generationId = 'navigation-overlap';
  const editorialPath = 'catalog-editorial/current.json';
  const facetsPath = 'catalog/public/facets.json';
  const manifestPath = 'catalog/manifest.json';
  const summaryPath = 'catalog/public/brand-summary.json';
  const facets = {generationId, makes:['BMW','BYD'], models:[{make:'BMW',model:'3 Series'},{make:'BYD',model:'Seal'}],
    markets:['china','europe'],bodyTypes:['sedan'],fuels:['petrol'],transmissions:['manual'],drives:['fwd']};
  const values = new Map<string, unknown>([
    [manifestPath, {generationId}],
    [facetsPath, facets],
    [summaryPath, {generationId,brands:{
      bmw:{make:'BMW',marketCounts:{europe:1},models:[{model:'3 Series',marketCounts:{europe:1}}]},
      byd:{make:'BYD',marketCounts:{china:1},models:[{model:'Seal',marketCounts:{china:1}}]},
    }}],
    [editorialPath, {revision:'current-overlap',entries:{
      visible:{id:'visible',status:'visible',market:'china',specifications:{bodyType:'suv',drive:'awd',transmission:'automatic'}},
      hidden:{id:'hidden',status:'hidden',market:'china',specifications:{bodyType:'coupe',drive:'rwd',transmission:'cvt'}},
      otherMarket:{id:'other',status:'visible',market:'europe',specifications:{bodyType:'pickup',drive:'rwd',transmission:'cvt'}},
    }}],
  ]);
  const before = JSON.stringify([...values]);
  const gates = new Map([...values.keys()].map(path => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return [path, {promise, release}] as const;
  }));
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  const reads: string[] = [];
  let active = 0, peak = 0, settled = false;
  t.mock.method(getJsonStorage(), 'readJsonWithMeta', async (path: string) => {
    assert.ok(values.has(path), `unexpected navigation read: ${path}`);
    reads.push(path);
    peak = Math.max(peak, ++active);
    try {
      await gates.get(path)!.promise;
      return {found:true,value:values.get(path)};
    } finally { active--; }
  });
  resetCatalogReadCachesForTests();
  const pending = Promise.all([readCatalogNavigationFacets('china'),readCatalogNavigationFacets('china')]);
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await flush();
    assert.deepEqual([...reads].sort(), [editorialPath,facetsPath].sort(),
      'raw facets must start while the current editorial read is still pending');
    assert.equal(active,2);
    gates.get(editorialPath)!.release();
    await flush();
    assert.deepEqual(reads.slice(2),[manifestPath], 'brand summary must wait for the manifest');
    assert.equal(active,2);
    gates.get(manifestPath)!.release();
    await flush();
    assert.deepEqual(reads.slice(2),[manifestPath,summaryPath]);
    assert.equal(active,2);
    gates.get(summaryPath)!.release();
    await flush();
    assert.equal(settled,false,'navigation must await the raw facets before producing options');
    gates.get(facetsPath)!.release();
    const results = await pending;
    for (const result of results) {
      assert.deepEqual(result.makes,['BYD']);
      assert.deepEqual(result.models,[{make:'BYD',model:'Seal'}]);
      assert.deepEqual(result.bodyTypes,['sedan','suv']);
      assert.deepEqual(result.drives,['awd','fwd']);
      assert.deepEqual(result.transmissions,['automatic','manual']);
    }
    assert.equal(peak,2,'overlap must not increase this dependency chain beyond two active reads');
    assert.equal(reads.length,4,'concurrent navigation requests must share the same pending reads');
    assert.equal(JSON.stringify([...values]),before,'editorial options must not mutate the published directory');
  } finally {
    for (const gate of gates.values()) gate.release();
    await Promise.allSettled([pending]);
    t.mock.restoreAll();
    resetCatalogReadCachesForTests();
  }
});

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
