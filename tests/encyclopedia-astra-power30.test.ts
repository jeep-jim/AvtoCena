import test,{mock} from 'node:test';
import fs from 'node:fs';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {applyActiveBusinessPriceBatch} from '../apps/web/lib/catalog/live-business-pricing';
import {resetCalculationIndexForTests} from '../apps/web/lib/encyclopedia/calculation-index';
import assert from 'node:assert/strict';
import {compileAstraPower30Facts,matchAstraPower30,astraPower30Key} from '../apps/web/lib/encyclopedia/astra-power30';
import {applyEncyclopediaCalculation,modelKey,checksum} from '../apps/web/lib/encyclopedia/calculation-index';
import {hasAstraPower30Evidence} from '../apps/web/lib/encyclopedia/astra-power30-evidence';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
const hash='a'.repeat(64),values:any={fuel:'electric',powertrainKind:'electric',powerKw:150,motorPeakKw:150,power30MinKw:54,drive:'fwd',engineCode:'EM57',transmission:'automatic',bodyType:'hatchback'};
const variant=(patch:any={}):any=>({id:'v',status:'review',...values,astraIdentity:{approval:'e1*2018/858*001*02',type:'ZE1',variant:'ABC',version:'123'},astraEvidence:{values:{...values},sourceUrl:'https://opendata.astra.admin.ch/ivzod/3000-eDatenblatt/eDatenblatt.csv',sourceSha256:hash,corpusDigest:hash,evidenceIds:[hash],sourceDataset:'edatenblatt',manufactureYears:[2020]},...patch});
const record=(variants:any[])=>({id:'model',make:'Test',model:'EV',revision:'r',variants});
const offer:any={id:'car',make:'Test',model:'EV',year:2024,market:'japan',fuel:'electric',powertrainKind:'electric',powerKw:150,drive:'fwd',engineCode:'EM57'};
function index(rows:any[]){const models={[astraPower30Key(modelKey('Test','EV'))]:compileAstraPower30Facts(record(rows))};return {version:1 as const,createdAt:'now',manifestDigest:hash,digest:checksum(models),models};}
const apply=(o:any,rows:any[])=>applyEncyclopediaCalculation(o,index(rows));
test('yearless official evidence is compiled without manufacturing a model year or ordinary outputs',()=>{
 const [f]=compileAstraPower30Facts(record([variant()]));assert.equal(f.year,0);assert.deepEqual(f.values,{power30MinKw:54});assert.deepEqual(f.trims,[]);
 const result=apply(offer,[variant()]);assert.equal(result.power30MinKw,54);assert.equal(result.year,2024);assert.equal(result.powerKw,150);assert.equal(result.engineCc,undefined);assert.equal(hasAstraPower30Evidence(result),true);
 assert.equal(classifySpecificationEvidence(result,'certifiedPower').state,'exact');
 assert.equal(result.operational.astraPower30Match.method,'engine_powertrain_consensus');
});
test('same bound power works across markets; source code and complete approval matching are distinct',()=>{
 for(const market of ['japan','china','korea','europe','georgia','uae'])assert.equal(apply({...offer,market},[variant()]).power30MinKw,54);
 assert.equal(apply({...offer,engineCode:undefined,chassisCode:'ZAA-ZE1'},[variant()]).power30MinKw,54);
 const exact={...offer,engineCode:undefined,drive:undefined,powerKw:undefined,typeApprovalIdentity:variant().astraIdentity};assert.equal(apply(exact,[variant()]).power30MinKw,54);
 assert.equal(apply({...exact,typeApprovalIdentity:{...exact.typeApprovalIdentity,version:'wrong'}},[variant()]).power30MinKw,undefined);
});
test('all plausible candidates participate: disagreement and missing measurements block inference',()=>{
 const sibling=variant({id:'sibling',power30MinKw:60,astraEvidence:{...variant().astraEvidence,values:{...values,power30MinKw:60}}});
 assert.equal(apply(offer,[variant(),sibling]).power30MinKw,undefined);
 const missing=variant({id:'missing',power30MinKw:undefined,astraEvidence:{...variant().astraEvidence,values:{...values,power30MinKw:undefined}}});
 assert.equal(apply(offer,[variant(),missing]).power30MinKw,undefined);
 const sparse=variant({id:'sparse',powerKw:undefined,engineCode:undefined,astraEvidence:{...variant().astraEvidence,values:{...values,powerKw:undefined,engineCode:undefined,power30MinKw:60}},power30MinKw:60});
 assert.equal(apply(offer,[variant(),sparse]).power30MinKw,undefined);
 for(const patch of [{drive:'awd'},{powerKw:300},{engineCode:'OTHER12'},{drive:undefined},{powerKw:undefined},{fuel:'petrol'},{model:'Other'}])assert.equal(apply({...offer,...patch},[variant()]).power30MinKw,undefined);
});
test('never overwrite manual, existing, conflicting or mismatched certificate values',()=>{
 assert.equal(apply({...offer,power30MinKw:45},[variant()]).power30MinKw,45);
 assert.equal(apply({...offer,powerDataSource:'customer_input'},[variant()]).power30MinKw,undefined);
 assert.equal(apply({...offer,operational:{semanticEvidence:{power30MinKw:{status:'conflict'}}}},[variant()]).power30MinKw,undefined);
 for(const v of [variant({power30MinKw:70}),variant({drive:'awd'}),variant({status:'verified'}),variant({astraEvidence:{...variant().astraEvidence,sourceDataset:'targa'}})])assert.equal(apply(offer,[v]).power30MinKw,undefined);
});
test('proof binds vehicle, year, supplied anchors and power; repeated apply is stable',()=>{
 const idx=index([variant()]),first=applyEncyclopediaCalculation({...offer,totalRub:999},idx);assert.equal(first.totalRub,null);
 const priced={...first,totalRub:1234};assert.equal(applyEncyclopediaCalculation(priced,idx),priced);
 for(const patch of [{id:'other'},{year:2023},{make:'Other'},{powerKw:100},{drive:'awd'},{power30MinKw:60}])assert.equal(hasAstraPower30Evidence({...first,...patch}),false);
 assert.equal(hasAstraPower30Evidence(JSON.parse(JSON.stringify(first))),true);
 assert.equal(matchAstraPower30(offer,[]).reason,'no_model_reference');
});
test('complete electric mechanical vector supports absent codes and hp-to-kW matching, never a peak-to-30min formula',()=>{
 const o={...offer,engineCode:undefined,powerKw:undefined,powerHp:204,transmission:'automatic',bodyType:'hatchback'};
 assert.equal(apply(o,[variant()]).power30MinKw,54);
 assert.equal(apply({...o,drive:undefined},[variant()]).power30MinKw,undefined);
 const other=variant({id:'other',power30MinKw:55,astraEvidence:{...variant().astraEvidence,values:{...values,power30MinKw:55}}});
 assert.equal(apply(o,[variant(),other]).power30MinKw,undefined);
});

test('withdrawn evidence clears dependent totals; chassis is bound to proof',()=>{
 const o={...offer,chassisCode:'ZAA-ZE1'},idx=index([variant()]),first=applyEncyclopediaCalculation(o,idx);
 assert.equal(hasAstraPower30Evidence({...first,chassisCode:'OTHER'}),false);
 const retired=applyEncyclopediaCalculation({...first,totalRub:999,savedCalculationPreview:{totalRub:999}},index([]));
 assert.equal(retired.power30MinKw,undefined);assert.equal(retired.totalRub,null);assert.equal(retired.savedCalculationPreview,undefined);
});
test('search projection retains mechanical anchors and certificate proof',async()=>{
 const {searchProjectionFromOffer}=await import('../apps/web/lib/catalog/storage');
 const o=apply({...offer,motorPeakKw:150,batteryKwh:60,bodyType:'hatchback',transmission:'automatic',images:[],operational:{semanticEvidence:{fuel:{status:'exact'},powertrainKind:{status:'exact'},powerKw:{status:'exact'}}}},[variant()]);
 const projected=searchProjectionFromOffer(o);
 assert.equal(projected.motorPeakKw,150);assert.equal(projected.batteryKwh,60);
 assert.equal(hasAstraPower30Evidence(projected),true,JSON.stringify({projected,original:o}));
});

test('ASTRA-only certified power reaches the actual price engine and serialized card',async()=>{
 const today=new Date().toISOString(),markets=JSON.parse(fs.readFileSync('data/markets/markets.json','utf8'));
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();invalidateEffectiveMarketsCache();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string,fallback:any)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:today,EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:'cbr'},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:'cbr'}}:key==='markets/markets.json'?markets:fallback}));
 const originalRead=fs.readFileSync,bundled=index([variant()]);
 const indexRead=mock.method(fs,'readFileSync',((file:any,...args:any[])=>String(file).endsWith('/knowledge/encyclopedia/calculation-v1.json')?JSON.stringify(bundled):(originalRead as any)(file,...args)) as any);resetCalculationIndexForTests();
 try{
  const o:any={...offer,market:'europe',sourcePrice:10000,sourceCurrency:'EUR',powerHp:204,bodyType:'hatchback',images:[],status:'active',offerType:'fixed',operational:{semanticEvidence:{fuel:{status:'exact'},powertrainKind:{status:'exact'},powerHp:{status:'exact'},powerKw:{status:'exact'}}}};
  const [priced]=await applyActiveBusinessPriceBatch([o],{readOnly:true});
  assert.equal(priced.power30MinKw,54);assert.ok(Number(priced.totalRub)>950000,JSON.stringify(priced));
  const {publicOffer}=await import('../apps/web/lib/catalog/storage');
  const publicCard=JSON.parse(JSON.stringify(publicOffer(priced)));
  assert.equal(hasAstraPower30Evidence(publicCard),true);
  const [replayed]=await applyActiveBusinessPriceBatch([publicCard],{readOnly:true});
  assert.equal(replayed.totalRub,priced.totalRub);
 }finally{read.mock.restore();indexRead.mock.restore();resetCalculationIndexForTests();resetCatalogRateCache();invalidateEffectiveMarketsCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});

test('code-less consensus needs drive and documented component power; differing or missing certificates block',()=>{
 const o={...offer,engineCode:undefined};assert.equal(apply(o,[variant()]).power30MinKw,54);
 assert.equal(apply({...o,drive:undefined},[variant()]).power30MinKw,undefined);
 const unknown=variant({id:'unknown',power30MinKw:undefined,astraEvidence:{...variant().astraEvidence,values:{...values,power30MinKw:undefined}}});
 assert.equal(apply(o,[variant(),unknown]).power30MinKw,undefined);
 const hv={fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,icePowerKw:68,motorPeakKw:59,power30MinKw:37,drive:'fwd'};
 const v=variant({...hv,powerKw:undefined,astraEvidence:{...variant().astraEvidence,values:hv}});
 const h={...o,...hv,power30MinKw:undefined,powerKw:undefined,motorPeakKw:undefined};
 assert.equal(apply(h,[v]).power30MinKw,37);
 assert.equal(apply({...h,icePowerKw:undefined,powerHp:92},[v]).power30MinKw,undefined);
});
