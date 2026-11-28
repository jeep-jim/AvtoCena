import test from 'node:test';
import assert from 'node:assert/strict';
import {japanSourceBody} from '../apps/web/lib/catalog/japan-source-body';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {applyAjesLotAdmission} from '../apps/web/lib/catalog/ajes-admission';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';

const row={ID:'body-example',MARKA_NAME:'TOYOTA',MODEL_NAME:'TEST',YEAR:2023,STATUS:'Sold',FINISH:935000,AUCTION_TYPE:2,PW:'150',TIME:'P'};
const rate={currency:'JPY',cbrRate:60,nominal:100,effectiveRate:.6,rateDate:'2026-11-28',rateSource:'cbr',sourcePrice:935000,sourcePriceRub:561000} as const;
const observedAt='2026-11-28T10:00:00Z';
const empty={editorial:{revision:'0',entries:{}},calculationIndex:null};
const offer=(body:unknown)=>applyAjesLotAdmission(ajesLot({...row,BODY_TYPE:body},'stats',false)!,rate,observedAt,empty)!;

test('AJ body labels are normalized only when the source explicitly names one category',()=>{
 for(const [label,expected] of [[' SUV ','suv'],['ＣＲＯＳＳＯＶＥＲ','suv'],['Кроссовер','suv'],['off-road','offroad'],['saloon','sedan'],['station  wagon','wagon'],['MPV','minivan'],['van','van'],['pick-up','pickup']]){
  assert.equal(japanSourceBody(label),expected,label);
 }
 for(const label of [undefined,null,1,'','unknown','SUV, sedan','SUV/MPV','MXAA54','sport','utility','wagon SUV','__proto__']){
  assert.equal(japanSourceBody(label),undefined,String(label));
 }
});

test('AJ LIST body survives normalization, offer admission and crossover filtering with source provenance',()=>{
 for(const body of ['SUV','crossover','Кроссовер']){
  const result=offer(body);
  assert.equal(result.bodyType,'suv');
  assert.equal(ajesResultFilter({market:'japan',bodyType:'suv',powerTo:'160'}).matches(result),true);
  assert.equal(ajesResultFilter({market:'japan',bodyType:'sedan'}).matches(result),false);
  assert.deepEqual(result.operational?.semanticEvidence?.bodyType,{status:'exact',value:'suv',source:'ajes:stats:body-example:BODY_TYPE',rawValues:[body]});
  assert.equal(result.operational?.raw?.sourceBody,body);
  assert.equal(result.powerHp,undefined,'body evidence does not certify horsepower');
  assert.equal(result.grossVehicleWeightKg,undefined,'body evidence does not certify permitted gross mass');
 }
});

test('a model or chassis name cannot invent a missing body, and old saved lots still work',()=>{
 for(const body of [undefined,'','SUV, sedan','unknown']){
  const lot=ajesLot({...row,MODEL_NAME:'RAV4',KUZOV:'MXAA54',BODY_TYPE:body},'stats',false)!;
  const result=ajesOffer(lot,rate,observedAt);
  assert.equal(result.bodyType,undefined);
  assert.equal(result.operational?.semanticEvidence?.bodyType,undefined);
  assert.equal(ajesResultFilter({market:'japan',bodyType:'suv'}).matches(result),false);
 }
 const lot=ajesLot(row,'stats',false)!;
 delete (lot as any).sourceBody;
 assert.equal(ajesOffer(lot,rate,observedAt).bodyType,undefined);
});

test('editorial body retains priority and ordinary minivans/vans remain admitted',()=>{
 const lot=ajesLot({...row,BODY_TYPE:'suv'},'stats',false)!;
 const edited=applyAjesLotAdmission(lot,rate,observedAt,{...empty,editorial:{revision:'manual-1',entries:{'ajes-stats-body-example':{
  id:'ajes-stats-body-example',market:'japan',sourceId:'ajes_japan_feed',sourceOfferId:'body-example',status:'visible',specifications:{bodyType:'sedan'},
 } as any}}})!;
 assert.equal(edited.bodyType,'sedan');
 assert.equal(ajesResultFilter({market:'japan',bodyType:'suv'}).matches(edited),false);
 assert.equal(ajesResultFilter({market:'japan',bodyType:'sedan'}).matches(edited),true);
 for(const [label,body] of [['MPV','minivan'],['van','van']]){
  const result=offer(label);assert.ok(result);assert.equal(result.bodyType,body);
  assert.equal(ajesResultFilter({market:'japan',bodyType:body}).matches(result),true);
 }
 assert.equal(ajesLot({...row,BODY_TYPE:'bus'},'stats',false),null);
});

test('the existing query cache preserves an explicit AJ body without an extra request',async()=>{
 let calls=0;
 const client=createAjesClient({password:()=> 'private-fixture',assertEnabled:async()=>{},reserve:async()=>{},fetcher:async()=>{
  calls++;return new Response(JSON.stringify([{...row,BODY_TYPE:'SUV'}]));
 }});
 const first=await client.read({table:'stats'},'203.0.113.11');
 const second=await client.read({table:'stats'},'203.0.113.11');
 assert.equal(calls,1);
 for(const page of [first,second]){
  assert.equal(page.items[0].sourceBody,'SUV');
  const result=applyAjesLotAdmission(page.items[0],rate,page.observedAt,empty)!;
  assert.equal(ajesResultFilter({market:'japan',bodyType:'suv'}).matches(result),true);
 }
});
