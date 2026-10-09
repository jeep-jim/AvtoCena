import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data';
import {withChinaCnyPrices} from '../apps/web/lib/catalog/china-cny-price';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {catalogSearchProjectionSort} from '../apps/web/lib/catalog/storage';
import {catalogDisplayOrderComparator,compareCatalogDisplayOrder} from '../apps/web/lib/catalog/display-order';

test('read-only price batches preserve saved anchors without copying unrelated entries or persisting new ones',async()=>{
 const storage=getJsonStorage(),read=storage.readJsonWithMeta,write=storage.writeJson;
 const today=new Date().toISOString().slice(0,10);
 const anchor={sourceCurrency:'USD',sourcePrice:10000,sourcePriceCny:65000,usdRub:85,cnyRub:13,rateDate:today};
 const savedId='saved-anchor',savedKey=createHash('sha256').update(JSON.stringify([savedId,10000])).digest('hex');
 const originalEntries=Object.freeze(Object.fromEntries([[savedKey,anchor],...Array.from({length:20000},(_,i)=>['unrelated-'+i,anchor])]));
 let enumerations=0,writes=0;
 const entries=new Proxy(originalEntries,{ownKeys(target){enumerations++;return Reflect.ownKeys(target);}});
 storage.readJsonWithMeta=async<T>(key:string,fallback:T)=>({found:true,value:(key.includes('china-cny-prices')?{version:1,entries}:key==='fees/exchange-rates.json'?{rates:[['USD',90],['CNY',12.5]].map(([currency,rate])=>({currency,cbrRate:rate,nominal:1,effectiveRate:rate,rateDate:today,rateSource:'cbr'}))}:fallback) as T});
 storage.writeJson=async()=>{writes++;throw Error('unexpected_write');};
 const saved:any={id:savedId,market:'china',sourceCurrency:'USD',sourcePrice:10000};
 const fresh:any={...saved,id:'new-readonly-price'};
 try{
  resetCatalogRateCache();
  await withChinaCnyPrices([saved],{readOnly:true}); // Cache fill and byte accounting may enumerate once.
  enumerations=0;
  const [a,b]=await withChinaCnyPrices([saved,fresh],{readOnly:true});
  assert.equal(a.sourcePrice,65000,'stored conversion wins over current FX');
  assert.equal(b.sourcePrice,72000,'new quote uses current official conversion');
  assert.equal(enumerations,0,'a small batch must not traverse the full saved-price index');
  assert.equal(writes,0);
  assert.equal(Object.keys(originalEntries).length,20001);
  assert.equal(fresh.sourceCurrency,'USD','input remains unchanged');
 }finally{storage.readJsonWithMeta=read;storage.writeJson=write;resetCatalogRateCache();}
});

test('projection ordering keeps legacy ties and policy while parsing each date once per sort',()=>{
 const values=Array.from({length:400},(_,i)=>({id:String(i),market:'china',totalRub:1000000,powerHp:120,updatedAt:'2026-10-01',sourcePublishedAt:new Date(Date.UTC(2026,8,1+i%28,0,i)).toISOString()}));
 const expected=[...values].sort((a,b)=>Date.parse(b.sourcePublishedAt)-Date.parse(a.sourcePublishedAt)).map(x=>x.id);
 let reads=0;
 const rows=values.map(row=>({...row,get sourcePublishedAt(){reads++;return row.sourcePublishedAt;}}));
 catalogSearchProjectionSort(rows as any[]);
 assert.deepEqual(rows.map(x=>x.id),expected);
 assert.equal(reads,rows.length,'date parsing is linear, not repeated inside O(n log n) comparisons');
 const cases:any[]=[{id:'missing'},{id:'affordable-high',totalRub:1e6,powerHp:200},{id:'affordable-low',totalRub:2e6,powerHp:120},{id:'expensive',totalRub:20e6},{id:'less-expensive',totalRub:16e6},{id:'hybrid-unknown',totalRub:1e6,powerHp:120,fuel:'hybrid'},{id:'certified',totalRub:1e6,fuel:'hybrid',utilizationPowerKw:80}];
 assert.deepEqual([...cases].sort(catalogDisplayOrderComparator()),[...cases].sort(compareCatalogDisplayOrder));
 cases[3].totalRub=1e6;cases[3].powerHp=100;
 assert.deepEqual([...cases].sort(catalogDisplayOrderComparator()),[...cases].sort(compareCatalogDisplayOrder),'repricing between sorts changes ranking immediately');
});

