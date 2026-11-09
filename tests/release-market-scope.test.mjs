import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {releaseMarkets,RELEASE_MARKETS,markerHomeCatalog,releaseHomeCatalogFlag,generationPagePreparation} from '../scripts/lib/release-market-scope.mjs';
test('explicit scope cannot silently turn into all markets',()=>{
 assert.equal(releaseMarkets(undefined),null);
 assert.deepEqual(releaseMarkets('korea'),['korea']);
 assert.deepEqual(releaseMarkets(['korea','japan']),['korea','japan']);
 for(const value of [[],['korea','korea'],'korea,','all','Korea',{},['china; echo bad']])assert.throws(()=>releaseMarkets(value),/scope_invalid/);
});
test('homepage acceptance requires an explicit boolean marker and a validated environment flag',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'home-release-'));
 const marker=path.join(dir,'marker.json');
 try{
  for(const [value,expected] of [[undefined,false],[false,false],[true,true]]){
   writeFileSync(marker,JSON.stringify({requireHomeCatalog:value}));assert.equal(markerHomeCatalog(marker),expected);
  }
  for(const value of ['true','1',1,null,{}]){
   writeFileSync(marker,JSON.stringify({requireHomeCatalog:value}));assert.throws(()=>markerHomeCatalog(marker),/flag_invalid/);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
 for(const value of [undefined,'','0'])assert.equal(releaseHomeCatalogFlag(value),false);
 assert.equal(releaseHomeCatalogFlag('1'),true);
 for(const value of ['true','yes',1,true,null])assert.throws(()=>releaseHomeCatalogFlag(value),/flag_invalid/);
});
test('home preparation expands only explicit releases and preserves ordinary scoped and full releases',()=>{
 assert.deepEqual(generationPagePreparation('korea'),{markets:['korea'],landingsOnly:true});
 assert.deepEqual(generationPagePreparation(undefined),{markets:RELEASE_MARKETS,landingsOnly:false});
 const home=generationPagePreparation('korea',true);
 assert.equal(home.landingsOnly,false);
 assert.deepEqual(new Set(home.markets),new Set(RELEASE_MARKETS));
 assert.equal(home.markets.includes('japan'),true,'shared overview retains all saved market summaries and facets');
 assert.deepEqual(generationPagePreparation(undefined,true),{markets:RELEASE_MARKETS,landingsOnly:false});
 assert.deepEqual(new Set(generationPagePreparation('japan',true).markets),new Set(RELEASE_MARKETS),'explicit Japan scope is retained');
});
