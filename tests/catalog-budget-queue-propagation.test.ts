import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage} from '../apps/web/lib/data';
import {readCalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {splitBudgetMarketIndex} from '../apps/web/lib/catalog/budget-market-index';
import {splitPackedBudgetSelectors,compressedBudgetSelectors,specificationSelectorDirectory} from '../apps/web/lib/catalog/budget-selector-codec';
import {readCompressedSelector,publishCompressedSelectors} from '../apps/web/lib/catalog/budget-selector-publication';
import {calculationCacheVersion} from '../apps/web/lib/catalog/shared-budget-prices';
import {countCatalogOffers,resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {DetailReadCacheQueueError} from '../apps/web/lib/catalog/detail-read-cache';

function fixture() {
  const generationId = 'queue-propagation';
  const rows = [
    {id:'sedan',market:'china',make:'Test',model:'Car',year:2024,totalRub:1500000,powerHp:123,bodyType:'sedan',fuel:'petrol'},
    {id:'suv',market:'china',make:'Test',model:'SUV',year:2024,totalRub:2000000,powerHp:150,bodyType:'suv',fuel:'petrol'},
  ];
  const index = buildBudgetCountIndex(generationId,rows as any[],new Map(),3);
  const partition = splitBudgetMarketIndex(index), packed = splitPackedBudgetSelectors(index), compressed = compressedBudgetSelectors(packed);
  const root = `catalog/generations/${generationId}/indexes/`;
  const encyclopediaDigest = readCalculationIndex()?.digest || null;
  const spec = specificationSelectorDirectory(encyclopediaDigest,calculationCacheVersion());
  const tiers = [
    {directory:root+spec+'/ready.json',part:root+spec+'/china.json',ready:{...compressed.directory,encyclopediaDigest},value:compressed.parts.get('china')},
    {directory:root+'budget-markets-v3/ready.json',part:root+'budget-markets-v3/china.json',ready:compressed.directory,value:compressed.parts.get('china')},
    {directory:root+'budget-markets-v2/ready.json',part:root+'budget-markets-v2/china.json',ready:packed.directory,value:packed.parts.get('china')},
    {directory:root+'budget-markets-v1/ready.json',part:root+'budget-markets-v1/china.json',ready:partition.directory,value:partition.parts.get('china')},
  ];
  const objects = new Map<string,unknown>([
    ['catalog/manifest.json',{generationId,markets:{china:{count:2}}}],
    ['catalog-editorial/current.json',{revision:'queue-test',entries:{}}],
    [root+'budget-count-v3.json',index],
  ]);
  return {generationId,index,compressed,root,tiers,objects};
}

function failure(message:'detail_cache_queue_timeout'|'detail_cache_queue_full',typed:boolean) {
  return typed ? new DetailReadCacheQueueError(message,{cache:'catalog_budget_index_cache',active:2,queued:4,oldestActiveMs:5000}) : new Error(message);
}

test('queue failure stops format fallback and full projection reads for directory and partition reads',async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  try {
    for (const typed of [true,false]) for (const message of ['detail_cache_queue_timeout','detail_cache_queue_full'] as const) {
      for (let tier = 0; tier < 4; tier++) for (const part of ['directory','part'] as const) {
        const f = fixture(), reads:string[] = [];
        for (const available of f.tiers.slice(tier)) {
          f.objects.set(available.directory,available.ready);f.objects.set(available.part,available.value);
        }
        const rejectedPath = f.tiers[tier][part], error = failure(message,typed);
        storage.readJsonWithMeta = async <T>(key:string,fallback:T) => {
          reads.push(key);
          if (key === rejectedPath) throw error;
          return {found:f.objects.has(key),value:(f.objects.get(key)??fallback) as T};
        };
        resetCatalogReadCachesForTests();
        await assert.rejects(countCatalogOffers({market:'china',bodyType:'sedan'}),caught => caught === error);
        assert.ok(reads.includes(rejectedPath));
        assert.deepEqual(reads.slice(reads.indexOf(rejectedPath)+1),[],`no reads after ${rejectedPath}`);
        assert.equal(reads.some(path=>/budget-count-v[123]|\/projection\//.test(path)),false);
      }
    }
  } finally {storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});

test('missing, unsupported and corrupt formats keep verified fallback behavior',async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  try {
    for (const mode of ['missing','unsupported','corrupt','other-error','all-missing'] as const) {
      const f = fixture(), reads:string[]=[];
      if (mode !== 'all-missing') {
        f.objects.set(f.tiers[2].directory,f.tiers[2].ready);f.objects.set(f.tiers[2].part,f.tiers[2].value);
      }
      if (mode !== 'missing' && mode !== 'all-missing') {
        f.objects.set(f.tiers[1].directory,mode==='unsupported'?{...f.tiers[1].ready,version:99}:f.tiers[1].ready);
        f.objects.set(f.tiers[1].part,{encoding:'gzip-base64',payload:'corrupt'});
      }
      storage.readJsonWithMeta = async <T>(key:string,fallback:T) => {
        reads.push(key);
        if (mode === 'other-error' && key === f.tiers[1].part) throw Error('existing_storage_error_behavior');
        return {found:f.objects.has(key),value:(f.objects.get(key)??fallback) as T};
      };
      resetCatalogReadCachesForTests();
      assert.equal((await countCatalogOffers({market:'china',bodyType:'sedan'})).total,1,mode);
      assert.equal(reads.includes(f.root+'budget-count-v3.json'),mode==='all-missing');
      if (mode !== 'all-missing') assert.ok(reads.includes(f.tiers[2].part));
      assert.equal(reads.some(path=>path.includes('/projection/')),false);
    }
  } finally {storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});

test('aggregate selector rejects overload once and can retry after the queue recovers',async () => {
  const storage=getJsonStorage(),original=storage.readJsonWithMeta,f=fixture(),reads:string[]=[];
  f.objects.set(f.tiers[0].directory,f.tiers[0].ready);f.objects.set(f.tiers[0].part,f.tiers[0].value);
  const error=failure('detail_cache_queue_timeout',true);let overloaded=true;
  storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>{
    reads.push(key);if(overloaded&&key===f.tiers[0].part)throw error;
    return {found:f.objects.has(key),value:(f.objects.get(key)??fallback) as T};
  };
  try {
    resetCatalogReadCachesForTests();
    await assert.rejects(countCatalogOffers({bodyType:'sedan'}),caught=>caught===error);
    assert.equal(reads.some(path=>/budget-count-v[123]|\/projection\//.test(path)),false);
    overloaded=false;
    assert.equal((await countCatalogOffers({bodyType:'sedan'})).total,1);
    assert.equal(reads.filter(path=>path===f.tiers[0].part).length,2,'failed aggregate promise was released');
  } finally {storage.readJsonWithMeta=original;resetCatalogReadCachesForTests();}
});

test('compressed v3 and chunked v4 readers retain exact typed and legacy queue failures',async () => {
  const f=fixture(),objects=new Map<string,any>();
  const chunked=await publishCompressedSelectors(f.index,async name=>objects.get(name),async(name,value)=>{objects.set(name,value);});
  for(const directory of [f.compressed.directory,chunked])for(const typed of [true,false])for(const message of ['detail_cache_queue_timeout','detail_cache_queue_full'] as const){
    const error=failure(message,typed);let calls=0;
    await assert.rejects(readCompressedSelector(directory,'china',async()=>{calls++;throw error;}),caught=>caught===error);
    assert.equal(calls,1);
  }
});
