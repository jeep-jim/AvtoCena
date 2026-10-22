import test,{mock} from 'node:test';
import fs from 'node:fs';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
import {applyActiveBusinessPriceBatch,applyActiveBusinessPricing} from '../apps/web/lib/catalog/live-business-pricing';
import {publicOffer,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
import assert from 'node:assert/strict';
import {compileModelFacts,applyEncyclopediaCalculation,checksum,modelKey,hasEncyclopediaCalculationEvidence,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {specificationEvidenceComplete} from '../apps/web/lib/catalog/modification-matching';
import {applyUaeManualSpecifications} from '../apps/web/lib/catalog/uae-manual-specifications';
import {japanPreviewParameters} from '../apps/web/lib/catalog/japan-preview-parameters';
const record=(variants:any[])=>({id:'model',make:'Audi',model:'A6',revision:'r1',variants});
const base={id:'v1',year:2023,trim:'40 TDI S tronic',status:'observed',markets:['europe'],fuel:'diesel',powertrainKind:'combustion',engineCc:1968,powerHp:204,powerKw:150,transmission:'dct',drive:'fwd'};
const offer=()=>({make:'Audi',model:'A6',year:2023,trim:base.trim,market:'korea',sourceId:'ajes_korea_feed',sourceOfferId:'1',id:'1',fuel:'diesel',transmission:'dct',drive:'fwd',operational:{}});
function index(variants:any[]):CalculationIndex{const models={[modelKey('Audi','A6')]:compileModelFacts(record(variants))};return {version:1,digest:checksum(models),createdAt:'2026-10-22',manifestDigest:'x',models};}
test('owner-approved Europe facts fill exact Korean variant without promoting observations to factory verification',()=>{
 const i=index([base]),out:any=applyEncyclopediaCalculation(offer(),i);
 assert.equal(out.engineCc,1968);assert.equal(out.powerHp,204);assert.equal(out.powerDataConfidence,'source_exact');
 assert.equal(out.operational.encyclopediaCalculation.provenance.powerHp[0].kind,'owner_reference');
 assert.equal(base.status,'observed');assert.equal(specificationEvidenceComplete(out),true);
 assert.equal(hasEncyclopediaCalculationEvidence(out),true);
});
test('different year, model, fuel, transmission, generation or trim cannot borrow power',()=>{
 for(const patch of [{year:2022},{model:'A6L'},{fuel:'petrol'},{transmission:'manual'},{generation:'C9'},{trim:'45 TFSI'}]){
  const input={...offer(),...patch};assert.equal(applyEncyclopediaCalculation(input,index([base])),input);
 }
});
test('ambiguous exact trim does not select a winning engine and generic trim is never technical identity',()=>{
 const out:any=applyEncyclopediaCalculation(offer(),index([base,{...base,id:'v2',engineCc:2967,powerHp:245,powerKw:180}]));
 assert.equal(out.powerHp,undefined);assert.equal(out.engineCc,undefined);
 const input={...offer(),trim:'Premium'};assert.equal(applyEncyclopediaCalculation(input,index([{...base,trim:'Premium'}])),input);
});
test('factory evidence is field-specific, stale values and unconfirmed fields stay unavailable',()=>{
 const row={...base,status:'review',researchEvidence:{batchId:'research-1',checkedIdentity:{make:'Audi',model:'A6',year:2023,trim:base.trim},fields:['engineCc','powerHp'],values:{engineCc:1968,powerHp:204},source:{type:'manufacturer',url:'https://www.audi.com/spec.pdf'}}};
 const facts=compileModelFacts(record([row]));assert.deepEqual(Object.keys(facts[0].values).sort(),['engineCc','powerHp']);
 const stale=compileModelFacts(record([{...row,powerHp:245}]));assert.equal(stale[0].values.powerHp,undefined);
 const out:any=applyEncyclopediaCalculation(offer(),index([row]));assert.equal(out.powerHp,204);assert.equal(out.powertrainKind,undefined);
 assert.equal(classifySpecificationEvidence(out,'powerHp').state,'exact');
});
test('manual input and explicit conflicts survive; a source value is never replaced',()=>{
 const manual={...offer(),powerDataSource:'customer_input',powerHp:210};assert.equal(applyEncyclopediaCalculation(manual,index([base])),manual);
 const existing={...offer(),powerHp:210};assert.equal(applyEncyclopediaCalculation(existing,index([base])),existing);
 const conflict={...offer(),operational:{semanticEvidence:{powerHp:{status:'conflict'}}}};
 assert.equal((applyEncyclopediaCalculation(conflict,index([base])) as any).powerHp,undefined);
});
test('peak and nominal electric power cannot fill certified 30-minute power',()=>{
 const row={...base,fuel:'electric',powertrainKind:'electric',engineCc:undefined,powerHp:340,powerKw:250,power30MinKw:80};
 const input={...offer(),fuel:'electric'};const out:any=applyEncyclopediaCalculation(input,index([row]));
 assert.equal(out.power30MinKw,undefined);assert.equal(classifySpecificationEvidence(out,'certifiedPower').state,'missing');assert.equal(specificationEvidenceComplete(out),false);
});
test('UAE seller data is discarded first; only independently matched encyclopedia fields survive sanitation',()=>{
 const raw={...offer(),market:'uae',powerHp:999,engineCc:9999};
 const safe=applyUaeManualSpecifications(raw);assert.equal(safe.powerHp,undefined);
 const matched:any=applyEncyclopediaCalculation(safe,index([base]));assert.equal(matched.powerHp,204);
 assert.equal(applyUaeManualSpecifications(matched),matched);
 const changed={...matched,powerHp:999};assert.equal(hasEncyclopediaCalculationEvidence(changed),false);assert.equal(applyUaeManualSpecifications(changed).powerHp,undefined);
});
test('no index means no inference; original records are immutable and repeated enrichment is stable',()=>{
 const input=offer(),before=JSON.stringify(input);assert.equal(applyEncyclopediaCalculation(input,null),input);
 const i=index([base]),result=applyEncyclopediaCalculation(input,i);assert.equal(JSON.stringify(input),before);assert.equal(applyEncyclopediaCalculation(result,i),result);
});
test('auction preview uses exact encyclopedia fields while unknown electric certification stays missing',()=>{
 const input:any={...offer(),id:'ajes-stats-123',market:'japan',sourceId:'ajes_japan_feed',catalogPricingMode:'seller',bodyType:'sedan',vehicleCategory:'M1'};
 const matched:any=applyEncyclopediaCalculation(input,index([base]));
 const parameters=japanPreviewParameters(matched);
 assert.equal(parameters.engineCc,1968);assert.equal(parameters.powerHp,204);
 assert.equal(hasEncyclopediaCalculationEvidence(matched),true);
 assert.equal(input.powerHp,undefined);
 const electric={...base,fuel:'electric',powertrainKind:'electric',engineCc:undefined,powerHp:340,powerKw:250};
 const ev:any=applyEncyclopediaCalculation({...input,fuel:'electric'},index([electric]));
 assert.equal(ev.power30MinKw,undefined);assert.throws(()=>japanPreviewParameters(ev));
});
test('an exact encyclopedia match upgrades a seller card through the real engine and agrees with detail replay',async()=>{
 const today=new Date().toISOString(),markets=JSON.parse(fs.readFileSync('data/markets/markets.json','utf8'));
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();invalidateEffectiveMarketsCache();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string,fallback:any)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:today,EUR:{cbrRate:95,nominal:1,rateDate:today,rateSource:'cbr'},USD:{cbrRate:90,nominal:1,rateDate:today,rateSource:'cbr'},AED:{cbrRate:25,nominal:1,rateDate:today,rateSource:'cbr'}}:key==='markets/markets.json'?markets:fallback}));
 try{
  for(const market of ['europe','uae']){
   const input:any={...offer(),market,sourcePrice:10000,sourceCurrency:'EUR',catalogPricingMode:'seller',sellerPriceRub:950000,totalRub:null,calculationStatus:'needs_data',bodyType:'sedan',images:[],status:'active',offerType:'fixed'};
   const matched=applyEncyclopediaCalculation(input,index([base]));
   const publicPending=publicOffer(matched as any);
   assert.equal((publicPending as any).operational,undefined);
   assert.equal(specificationEvidenceComplete(publicPending),true,'serialized search rows retain field-level calculation evidence');
   const [publicPriced]=await applyActiveBusinessPriceBatch([publicPending],{readOnly:true});
   const [card]=await applyActiveBusinessPriceBatch([matched],{readOnly:true});
   assert.ok(Number(card.totalRub)>950000,JSON.stringify(card.calculationSnapshot));
   assert.equal(card.catalogPricingMode,undefined);assert.equal(card.calculationSnapshot.customs.status,'ready');
   assert.equal(publicPriced.totalRub,card.totalRub,'public search and raw/detail calculations agree');
   assert.equal((await applyActiveBusinessPricing(matched)).totalRub,card.totalRub);
   const publicCard=publicOffer(card as any);
   assert.equal(applyUaeManualSpecifications(publicCard).powerHp,204,'browser-safe public card retains independently sourced power');
   assert.equal(searchProjectionFromOffer(card as any).encyclopediaCalculation?.indexDigest,index([base]).digest);
   assert.equal(input.totalRub,null);
  }
 }finally{read.mock.restore();resetCatalogRateCache();invalidateEffectiveMarketsCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
