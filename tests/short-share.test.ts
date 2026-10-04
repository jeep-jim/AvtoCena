import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanShareTarget,createShortShare,readShortShare} from '../apps/web/lib/catalog/short-share';
import {encodeShareDraft,decodeShareDraft} from '../apps/web/lib/catalog/offer-share';
import {miniAppLaunchPath} from '../apps/web/lib/telegram-miniapp';
import {StorageConflictError} from '../apps/web/lib/data';

test('short links preserve calculation, city, dealer and mini mode across subsequent reads',async()=>{
 const records=new Map<string,unknown>();
 const storage:any={readJson:async(key:string,fallback:unknown)=>records.get(key)??fallback,writeJson:async(key:string,value:unknown)=>{if(records.has(key))throw new StorageConflictError();records.set(key,value);}};
 const estimate=encodeShareDraft({year:'2024',deliveryCity:'Новокузнецк',engineCc:'1199',totalRub:'1'});
 const target=cleanShareTarget(`/cars/offer/chevrolet-trax-2024--f649514e83647d1d84c917e0?estimate=${estimate}&dealer=topavto&utm_source=secret`,true);
 const short=await createShortShare(target,storage);
 assert.equal(short.length,19);assert.match(short,/^\/s\/[A-Za-z0-9_-]{16}$/);
 assert.equal(await createShortShare(target,storage),short);assert.equal(records.size,1);
 const record=await readShortShare(short.slice(3),storage);assert.deepEqual(record,target);
 const query=new URL(record!.path,'https://avtocena.com').searchParams;
 assert.equal(query.get('dealer'),'topavto');assert.equal(query.has('utm_source'),false);
 assert.deepEqual(decodeShareDraft(query.get('estimate')!),{year:'2024',engineCc:'1199',deliveryCity:'Новокузнецк'});
 assert.equal(miniAppLaunchPath('short_'+short.slice(3)),short+'?open=web');
 const other=await createShortShare(cleanShareTarget(target.path,false),storage);assert.notEqual(other,short);
 const saved=cleanShareTarget('/cars/offer/car?calculation=11111111-1111-1111-1111-111111111111',false);
 assert.equal(new URL(saved.path,'https://avtocena.com').searchParams.get('calculation'),'11111111-1111-1111-1111-111111111111');
 assert.equal(await readShortShare('../not-a-token',storage),null);
 assert.equal(await readShortShare('xxxxxxxxxxxxxxxx',storage),null);
});
test('short links cannot redirect externally or publish private routes, arbitrary text or client prices',()=>{
 for(const path of ['https://evil.example','//evil.example/cars/offer/id','/crm/clients','/cars/offer/../../crm','/cars/offer/%2e%2e','/cars/offer/car?dealer=%3Cscript%3E','/cars/offer/car?estimate=bad!'])assert.throws(()=>cleanShareTarget(path,false));
 assert.equal(cleanShareTarget('/cars/offer/car?price=1&token=secret#x',false).path,'/cars/offer/car?share=3');
});
test('a short hash collision never overwrites an earlier link; storage failure propagates',async()=>{
 const records=new Map<string,unknown>();let conflict=true;
 const storage:any={readJson:async(key:string,fallback:unknown)=>{if(conflict){conflict=false;records.set(key,{version:1,path:'/cars/offer/previous?share=3',mini:false});}return records.get(key)??fallback;},writeJson:async(key:string,value:unknown)=>{assert.equal(records.has(key),false);records.set(key,value);}};
 const target=cleanShareTarget('/cars/offer/new',false),short=await createShortShare(target,storage);
 assert.equal(records.size,2);assert.deepEqual(await readShortShare(short.slice(3),storage),target);
 await assert.rejects(createShortShare(target,{readJson:async()=>null,writeJson:async()=>{throw Error('offline');}} as any),/offline/);
});
