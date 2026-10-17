import {resolveCatalogMarketConfig} from '../apps/web/lib/catalog/estimated-market-config';
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {defaultShowcase,normalizeShowcase,calculateSpecial,type SpecialOffer} from '../apps/web/lib/dealers/showcase-model';
import {marketOfferKey,marketRequest,orderedOffers,MARKET_CURRENCIES} from '../apps/web/lib/dealers/market-offer';
import {quoteMarketOffer} from '../apps/web/lib/dealers/market-offer-server';
import {publicRail} from '../apps/web/lib/dealers/public-rail';
import {mergeShowcaseChanges} from '../apps/web/lib/dealers/showcase-merge';
import {autocalcScenario} from '../apps/web/lib/autocalc/scenario';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {invalidateEffectiveMarketsCache} from '../apps/web/lib/effective-market-settings';
const car:SpecialOffer={id:'new-market',availability:'market',condition:'new',status:'published',market:'china',currency:'CNY',invoice:90000,purchaseTotal:100000,make:'Toyota',model:'RAV4',trim:'',year:2026,productionMonth:1,engineCc:1987,powerHp:150,power30MinKw:0,fuel:'petrol',transmission:'CVT',drive:'Полный',body:'SUV',color:'Белый',steering:'left',mileageKm:0,description:'',equipment:'',photos:[{id:'p',url:'/buyers/1.jpg',caption:''}],priceUsd:0,customsIncluded:false,customsExtraRub:0,personalUseEligible:false,defaultCity:'Новосибирск',updatedAt:''};
test('manual new offers exactly match existing market engine for six markets and three cities',async()=>{
 const today=new Date().toISOString().slice(0,10),rates:Record<string,number>={CNY:12,JPY:.6,KRW:.06,AED:23,EUR:95,GEL:32,USD:85};
 const fetcher=mock.method(globalThis,'fetch',async()=>new Response(`<ValCurs Date="${today.split('-').reverse().join('.')}">${Object.entries(rates).map(([c,r])=>`<Valute><CharCode>${c}</CharCode><Nominal>1</Nominal><Value>${r}</Value></Valute>`).join('')}</ValCurs>`));
 resetCatalogRateCache();invalidateEffectiveMarketsCache();
 try{
  for(const [market,currency] of Object.entries(MARKET_CURRENCIES)){
   const o={...car,market,currency,purchaseTotal:1500000/rates[currency],invoice:1400000/rates[currency]} as SpecialOffer;
   o.marketQuote=await quoteMarketOffer(o,'Новосибирск');
   assert.ok(o.marketQuote.input,`${market}: ${o.marketQuote.error}`);
   for(const city of ['Новосибирск','Москва','Владивосток']){
    const {offer,parameters}=autocalcScenario(marketRequest(o,city));
    const expected=await calculateOfferWithCustomerParametersDetailed(offer,parameters);
    assert.ok(expected.ok,market);const actual=calculateSpecial(defaultShowcase('dealer_topavto'),o,city);
    assert.equal(actual.totalRub,expected.calculation.totalRub,`${market}/${city}`);
    assert.equal(actual.lines.reduce((sum,line)=>sum+line.amountRub,0),actual.totalRub);
    assert.equal(actual.rate,rates[currency]);
   }
   assert.equal(calculateSpecial(defaultShowcase('dealer_topavto'),{...o,purchaseTotal:o.purchaseTotal!+1}).totalRub,null,'changed input invalidates quote');
   assert.equal(calculateSpecial(defaultShowcase('dealer_topavto'),{...o,marketQuote:{...o.marketQuote,at:'2020-01-01'}}).totalRub,null,'stale quote hidden');
  }
 }finally{fetcher.mock.restore();resetCatalogRateCache();invalidateEffectiveMarketsCache();}
});
test('new mode keeps invoice, forces new condition, drops forged quote, and isolates visibility',()=>{
 const s=defaultShowcase('dealer_topavto');s.marketEnabled=true;s.offers=[{...car,condition:'used',marketQuote:{key:'forged',rate:1,at:new Date().toISOString()}}];
 const saved=normalizeShowcase(s,s.dealerId,1);
 assert.equal(saved.offers[0].availability,'market');assert.equal(saved.offers[0].condition,'new');assert.equal(saved.offers[0].invoice,90000);assert.equal(saved.offers[0].marketQuote,undefined);
 assert.equal(publicRail(saved).length,1);assert.equal(publicRail(saved,'','home').length,0);
 saved.marketEnabled=false;saved.marketHomeEnabled=true;
 assert.equal(publicRail(saved).length,0);assert.equal(publicRail(saved,'','home').length,1);
 saved.marketHomeEnabled=false;assert.equal(publicRail(saved).length,0);
});
test('positions preserve legacy order and survive normalization and concurrent unrelated edits',()=>{
 const s=defaultShowcase('dealer_topavto');s.offers=[{...car,id:'one',status:'draft'},{...car,id:'two',status:'draft'},{...car,id:'three',status:'draft'}];
 assert.deepEqual(orderedOffers(s.offers).map(o=>o.id),['one','two','three']);
 const local={...s,offers:s.offers.map((o,i)=>({...o,position:[2,1,3][i]}))};
 const remote={...s,offers:s.offers.map(o=>o.id==='three'?{...o,color:'Чёрный'}:o)};
 const merged=mergeShowcaseChanges(s,local,remote);assert.deepEqual(merged.conflicts,[]);
 const saved=normalizeShowcase(merged.value,s.dealerId,1);assert.deepEqual(orderedOffers(saved.offers).map(o=>o.id),['two','one','three']);assert.equal(saved.offers[2].color,'Чёрный');
});

test('departure city survives saving and public rail; only domestic delivery changes',()=>{
 const s=defaultShowcase('dealer_topavto');s.marketEnabled=true;
 const o={...car,deliveryOriginCity:'Астрахань'};
 o.marketQuote={key:marketOfferKey(o),at:new Date().toISOString(),rate:12,input:{marketId:'china',marketConfig:resolveCatalogMarketConfig('china',{percentExpenses:[]}).config,sourcePriceRub:1200000,customsRub:200000,utilizationFeeRub:3400}};
 s.offers=[o];
 assert.equal(normalizeShowcase(s,s.dealerId,1).offers[0].deliveryOriginCity,'Астрахань');
 const first=calculateSpecial(s,o,'Москва'),second=calculateSpecial(s,{...o,deliveryOriginCity:'Санкт-Петербург'},'Москва');
 assert.ok(first.complete);assert.ok(second.complete);
 assert.notEqual(first.totalRub,second.totalRub);
 assert.deepEqual(first.lines.filter(l=>l.id!=='delivery'),second.lines.filter(l=>l.id!=='delivery'));
 assert.equal(first.lines.reduce((sum,l)=>sum+l.amountRub,0),first.totalRub);
 const rail=publicRail(s,'Москва')[0];assert.equal(rail.calculation?.offer.deliveryOriginCity,'Астрахань');
 assert.equal(calculateSpecial(s,{...o,deliveryOriginCity:'Неизвестный город'},'Москва').totalRub,null);
 const local=calculateSpecial(s,o,'Астрахань');assert.equal(local.lines.find(l=>l.id==='delivery')?.amountRub||0,0);
});
