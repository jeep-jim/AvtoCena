import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDealerRate,withDealerRate} from '../apps/web/lib/dealers/exchange-rate';
import {mergeShowcaseChanges} from '../apps/web/lib/dealers/showcase-merge';
import {defaultShowcase,type SpecialOffer} from '../apps/web/lib/dealers/showcase-model';
import {importedOffer,applyImportedOffer} from '../apps/web/lib/dealers/import-offer';
import {dealerProfilePath,validProfilePart} from '../apps/web/lib/dealers/profile-url';
import {miniAppPathAllowed} from '../apps/web/lib/telegram-miniapp';
import type {SourceDraft} from '../apps/web/lib/autocalc/load';
const source:SourceDraft={url:'https://example.com/car',title:'Toyota RAV4',make:'Toyota',model:'RAV4',market:'korea',price:'34000',currency:'USD',images:[],draft:{year:'2025',engineCc:'1998',powerHp:'150',productionMonth:'6',fuel:'petrol'},facts:[{label:'Коробка передач',value:'Автомат'},{label:'Пробег, км',value:'0'}]};
test('listing import keeps evidence, currency and tax decisions separate',()=>{
 const patch=importedOffer(source);
 assert.equal(patch.year,2025);assert.equal(patch.productionMonth,6);assert.equal(patch.priceUsd,34000);assert.equal(patch.transmission,'Автомат');assert.equal(patch.mileageKm,0);
 assert.equal(patch.customsIncluded,undefined);assert.equal(patch.personalUseEligible,undefined);
 assert.equal(importedOffer({...source,currency:'KRW'}).priceUsd,undefined);
 assert.equal(importedOffer({...source,draft:{fuel:'hybrid',powerHp:'150'}}).power30MinKw,undefined);
});
test('import preserves filled fields unless replacement is explicitly selected',()=>{
 const current={make:'Kia',model:'Sportage',year:2026,engineCc:0} as SpecialOffer;
 const p=importedOffer(source);assert.deepEqual(applyImportedOffer(current,p),{engineCc:1998,powerHp:150,productionMonth:6,fuel:'petrol',transmission:'Автомат',mileageKm:0,priceUsd:34000});
 assert.equal(applyImportedOffer(current,p,true).make,'Toyota');
});
test('stale editor merges independent changes and preserves remote additions',()=>{
 const base=defaultShowcase('dealer_topavto');const local=structuredClone(base),remote=structuredClone(base);
 local.description='Local description';remote.phone='79990000000';remote.version=2;
 remote.offices=[{id:'new',city:'Москва',address:'Тест',phone:'',hours:'',lat:null,lon:null,photos:[]}];
 const merged=mergeShowcaseChanges(base,local,remote);
 assert.deepEqual(merged.conflicts,[]);assert.equal(merged.value.description,local.description);assert.equal(merged.value.phone,remote.phone);assert.equal(merged.value.version,2);assert.equal(merged.value.offices.length,1);
});
test('same-field and deletion conflicts retain both versions for review',()=>{
 const base=defaultShowcase('dealer_topavto');const local=structuredClone(base),remote=structuredClone(base);local.name='Local';remote.name='Remote';
 assert.deepEqual(mergeShowcaseChanges(base,local,remote).conflicts,['name']);
 const b={items:[{id:'one',value:1}]},l={items:[]},r={items:[{id:'one',value:2}]};assert.deepEqual(mergeShowcaseChanges(b,l,r).conflicts,['items.one']);
});
test('ProFinance parser strips display direction but never accepts another ticker',()=>{
 const now=Date.parse('2026-09-30T12:30:45Z');const q=parseDealerRate('1;I=29;S=USD/RUB;TICK=USDRUB;LP=-84.004;T=12:30:44;NCHL=0.312',now);
 assert.equal(q?.value,84.004);assert.equal(q?.timeKind,'received');assert.equal(q?.fetchedAt,new Date(now).toISOString());
 for(const response of ['S=USD/RUB;TICK=USDRUB_F;LP=84;T=12:30:44','S=USD/RUB;TICK=USDRUB;LP=0;T=12:30:44','<html>Error</html>','S=USD/RUB;TICK=USDRUB;LP=84;T=unknown'])assert.equal(parseDealerRate(response,now),null);
});
test('public dealer links are valid Mini App destinations without admitting CRM',()=>{
 assert.equal(dealerProfilePath({dealerId:'dealer_topavto',citySlug:'nvkz',slug:'topavto'}),'/nvkz/topavto');
 for(const path of ['/','/nvkz/topavto','/msk/severauto','/dealers/dealer_topavto'])assert.equal(miniAppPathAllowed(path),true,path);
 for(const path of ['/crm/dealers','/api/secret','/admin/staff','/internal/settings'])assert.equal(miniAppPathAllowed(path),false,path);
 for(const slug of ['../evil','mini','request','crm','top avto'])assert.equal(validProfilePart(slug),false);
});
test('saving a stale editor merges independent edits, rejects conflicting edits and reserves links',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {resetJsonStorageForTests}=await import('../apps/web/lib/data');
 const {saveShowcase,readShowcase,resolveDealerProfile,ShowcaseConflict}=await import('../apps/web/lib/dealers/showcase-store');
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dealer-v2-'));
 try{
  await fs.mkdir(path.join(tmp,'data/dealers'),{recursive:true});await fs.writeFile(path.join(tmp,'data/dealers/dealers.json'),JSON.stringify([{id:'dealer_topavto',name:'TopAvto'},{id:'other',name:'Other'}]));
  process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
  const base=defaultShowcase('dealer_topavto');const first=await saveShowcase(base.dealerId,{...base,description:'remote'});
  const merged=await saveShowcase(base.dealerId,{...base,base,phone:'79990000000'});
  assert.equal(merged.version,2);assert.equal(merged.description,'remote');assert.equal(merged.phone,'79990000000');
  assert.equal(await resolveDealerProfile('nvkz','topavto'),base.dealerId);
  await fs.mkdir(path.join(tmp,'data/dealers/rates'),{recursive:true});
  await fs.writeFile(path.join(tmp,'data/dealers/rates/usdrub.json'),JSON.stringify({quote:{value:89.5,quoteAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),source:'https://www.profinance.ru/chart/usdrub/'},attemptAt:'',error:''}));
  const originalFetch=globalThis.fetch;let externalCalls=0;
  try{globalThis.fetch=(async()=>{externalCalls++;throw Error('Provider offline');}) as typeof fetch;
   assert.equal((await withDealerRate(merged)).pricing.usdRub,89.5);assert.equal(externalCalls,0);
  }finally{globalThis.fetch=originalFetch;}

  await assert.rejects(saveShowcase(base.dealerId,{...first,base:first,phone:'78880000000'}),ShowcaseConflict);
  assert.equal((await readShowcase(base.dealerId))?.phone,'79990000000');
  await assert.rejects(saveShowcase('other',{...defaultShowcase('other','Other'),citySlug:'nvkz',slug:'topavto'}),/занята/);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();await fs.rm(tmp,{recursive:true,force:true});}
});
