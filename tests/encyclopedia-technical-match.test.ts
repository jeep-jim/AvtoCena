import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEncyclopediaCalculation,compileModelFacts,modelKey,checksum,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
const donor:any={id:'v',year:2023,trim:'1.5 Hybrid Premium',chassisCode:'MXPH10',engineCode:'M15A-FXE',status:'observed',markets:['china'],fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1490,powerHp:91,powerKw:67,drive:'fwd',transmission:'cvt',power30MinKw:20};
function idx(rows:any[]):CalculationIndex{const models={[modelKey('Toyota','Yaris')]:compileModelFacts({id:'m',make:'Toyota',model:'Yaris',revision:'r',variants:rows})};return {version:1,createdAt:'now',manifestDigest:'m',digest:checksum(models),models};}
const offer:any={id:'jp',make:'Toyota',model:'Yaris',year:2023,trim:'HYBRID G',market:'japan',fuel:'hybrid',operational:{chassisCode:'MXPH10'}};
test('Japan nested chassis bridges different grade names only in requested technical mode',()=>{
 const i=idx([donor]);assert.equal(applyEncyclopediaCalculation(offer,i),offer);
 const out=applyEncyclopediaCalculation(offer,i,{technicalIdentity:true});assert.equal(out.powerHp,91);assert.equal(out.engineCc,1490);assert.equal(out.power30MinKw,undefined);assert.equal(out.operational.encyclopediaCalculation.matchMethod,'technical_identity');assert.equal(offer.powerHp,undefined);
});
test('different year, chassis, engine, fuel and manual edits cannot use the bridge',()=>{
 for(const patch of [{year:2022},{operational:{chassisCode:'MXPA10'}},{engineCode:'M15A-FKS'},{fuel:'petrol'},{powerDataSource:'customer_input'},{powerHp:150}]){const raw={...offer,...patch};assert.equal(applyEncyclopediaCalculation(raw,idx([donor]),{technicalIdentity:true}),raw);}
});
test('multiple power versions do not choose one; incomplete candidates block missing facts',()=>{
 const out=applyEncyclopediaCalculation(offer,idx([donor,{...donor,id:'v2',trim:'different',powerHp:120,powerKw:88}]),{technicalIdentity:true});assert.equal(out.powerHp,undefined);assert.equal(out.powerKw,undefined);
 const partial=applyEncyclopediaCalculation(offer,idx([donor,{...donor,id:'v2',powerHp:undefined,powerKw:undefined}]),{technicalIdentity:true});assert.equal(partial.powerHp,undefined);
});
test('same model and year without a technical code never imply identity',()=>{const raw={...offer,operational:{}};assert.equal(applyEncyclopediaCalculation(raw,idx([donor]),{technicalIdentity:true}),raw);});
test('conflicting named modification cannot fall through to another technical version',()=>{const raw={...offer,trim:donor.trim,engineCc:2000};assert.equal(applyEncyclopediaCalculation(raw,idx([donor]),{technicalIdentity:true}),raw);});

test('search projection preserves technical identity from the full saved card',async()=>{
 const {searchProjectionFromOffer}=await import('../apps/web/lib/catalog/storage');
 const out=searchProjectionFromOffer({...offer,engineCode:'M15A-FXE',generation:'XP210',images:[],sourcePrice:1000000,sourceCurrency:'JPY',catalogPricingMode:'seller'} as any);
 assert.equal(out.chassisCode,'MXPH10');assert.equal(out.engineCode,'M15A-FXE');assert.equal(out.generation,'XP210');
});

test('rounded Japanese auction displacement only qualifies with an exact chassis and never overwrites it',()=>{
 const raw={...offer,engineCc:1500};const result=applyEncyclopediaCalculation(raw,idx([donor]),{technicalIdentity:true});
 assert.equal(result.powerHp,91);assert.equal(result.engineCc,1500);
 assert.equal(result.operational.encyclopediaCalculation.values.engineCc,undefined);
 for(const patch of [{engineCc:1600},{engineCc:1501},{market:'korea'},{operational:{}}]){const bad={...raw,...patch};assert.equal(applyEncyclopediaCalculation(bad,idx([donor]),{technicalIdentity:true}),bad);}
});
