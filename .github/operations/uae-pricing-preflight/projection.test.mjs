import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {preflight,keys} from './projection.mjs';
const now=new Date('2026-11-20T10:00:00Z');
const r=(currency,rateDate='2026-11-20',rateSource='cbr')=>({currency,rateDate,rateSource,nominal:1,cbrRate:20});
const nominal={id:'private-profile-string',version:1,status:'active',effectiveFrom:'2026-11-19T00:00:00Z',currency:'AED',securityDepositRub:0,topAvtoCommissionRub:99,logisticsRub:99,brokerRub:99,svhRub:99,laboratoryRub:99,sbktsRub:0,eptsRub:0,rfDeliveryRub:99,otherFixedExpensesRub:0};
const check=async (rates,profile,index=null)=>{
  const hits=[];const result=await preflight({now,read:async key=>{hits.push(key);return key===keys.rates?{rates}:key===keys.commercial?[{id:'uae',versions:profile?[profile]:[]}]:index;}});
  assert.deepEqual(hits,Object.values(keys));return result;
};
test('only three fixed GET coordinates; complete approved base does not authorize a route or quote',async()=>{
  const models={private_model_key:[]};
  const x=await check([r('AED'),r('EUR'),r('USD')],nominal,{version:1,models,digest:createHash('sha256').update(JSON.stringify(models)).digest('hex')});
  assert.equal(x.fx.USD.status,'available_snapshot');assert.equal(x.commercial.explicitTermCount,10);
  assert.equal(x.sellerLocalFixtureInputAvailable,true);assert.equal(x.deliveredQuoteAuthorized,false);
  assert.equal(x.technical.modelGroupCount,1);assert.equal(x.technical.uaeListingMatchVerified,false);
  assert.doesNotMatch(JSON.stringify(x),/private_profile|private_model|cbrRate|private-profile-string/);
});
test('never accept stale, missing or bridged commercial/FX; do not check USD for unqualified profile',async()=>{
  const x=await check([r('AED','2026-11-15'),r('EUR','2026-11-20','unspecified'),r('USD')],{...nominal,logisticsRub:null});
  assert.equal(x.fx.AED.status,'stale');assert.equal(x.fx.EUR.status,'unverified_explicit_provenance');
  assert.equal(x.fx.USD,undefined);assert.equal(x.sellerLocalFixtureInputAvailable,false);
  assert.equal(x.commercial.status,'incomplete_or_provisional');
});
test('future/ambiguous snapshots never pass; index digest drift unavailable',async()=>{
  const x=await check([r('AED','2026-11-21'),r('EUR'),r('EUR')],null,{version:1,models:{},digest:'bad'});
  assert.equal(x.fx.AED.status,'future');assert.equal(x.fx.EUR.status,'ambiguous');assert.equal(x.technical.status,'missing_or_invalid_object_mirror');
});
