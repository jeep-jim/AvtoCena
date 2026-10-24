import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery,ajesLot,ajesCatalogQuery,ajesImageUrl} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer,ajesOfferId} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
const row={ID:'fixture001',MARKA_NAME:'HYUNDAI',MODEL_NAME:'TUCSON',YEAR:String(new Date().getUTCFullYear()-2),MONTH:'10',FINISH:'17400000',ENG_V:'1598',PW:'',TIME:'D',MILEAGE:'30000',SERIAL:'TESTFRAME123',IMAGES:'https://7.tru.ru/imgs/fixtureABC#https://7.tru.ru/imgs/fixtureDEF'};
test('stock SQL uses own table, market year policies and no Japanese auction columns',()=>{
 for(const market of ['korea','china'] as const){const q=ajesQuery(ajesCatalogQuery({market,make:'HYUNDAI',model:'TUCSON',lotNumber:'00012'}));assert.match(q.sql,new RegExp('from '+market));assert.match(q.sql,/lot='00012'/);assert.doesNotMatch(q.sql,/auction_type|status='Sold'/);assert.match(q.sql,/finish>0/);assert.match(q.sql,new RegExp('year>='+ (market==='china'?2014:new Date().getUTCFullYear()-6)));}
 assert.throws(()=>ajesQuery({table:'china',make:"x' OR 1=1"}));
 assert.match(ajesQuery({table:'korea',yearFrom:2008}).sql,new RegExp('year>='+(new Date().getUTCFullYear()-6)));
});
test('stock mapping keeps exact units, VIN and first photograph; missing power remains missing',()=>{
 assert.equal(ajesLot({...row,STATUS:'Sold'},'korea',true),null);
 const lot=ajesLot(row,'korea',true)!;assert.ok(lot);assert.equal(lot.images[0].role,'vehicle');assert.equal(lot.frameNumber,'TESTFRAME123');
 const offer=ajesOffer(lot,{rateSource:'cbr',currency:'KRW',sourcePrice:17400000,effectiveRate:0.06} as any,'2026-10-18T02:00:00Z');
 assert.equal(offer.sourcePrice,17400000);assert.equal(offer.sourceCurrency,'KRW');assert.equal(offer.sellerPriceRub,1044000);assert.equal(offer.fuel,'diesel');assert.equal(offer.powerHp,undefined);assert.equal(offer.totalRub,null);assert.equal(offer.status,'active');assert.equal(offer.images[0].role,'vehicle');assert.equal(offer.productionDate,`${row.YEAR}-10`);assert.ok(ajesOfferId(offer.id));assert.ok(ajesImageUrl(offer.images[0].url));
 const cn=ajesLot({...row,FINISH:'108000',PW:'104',TIME:'O'},'china',true)!;
 const c=ajesOffer(cn,{rateSource:'cbr',currency:'CNY',sourcePrice:108000,effectiveRate:12} as any,'2026-10-18');assert.equal(c.sourcePrice,108000);assert.equal(c.powerHp,104);assert.equal(c.fuel,undefined);
});
test('switch is checked by requested market; refusals stop without alternate routing',async()=>{
 const tables:string[]=[],urls:string[]=[];
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async t=>{tables.push(t!);},reserve:async()=>{},endpoint:()=> 'http://78.46.90.228/api/',fetcher:async url=>{urls.push(String(url));return new Response('ban2 fixture');}});
 await assert.rejects(()=>client.read({table:'korea'},'203.0.113.1'),/visitor_restricted/);assert.ok(tables.every(t=>t==='korea'));assert.equal(urls.length,1);assert.ok(urls[0].startsWith('http://78.46.90.228/api/'));
});

test('second China feed enforces 15 million at seller and delivered stages without changing Che168',async()=>{
 const {ajesChinaPriceAllowed,ajesChinaSourceCeiling}=await import('../apps/web/lib/catalog/ajes-price-policy');
 const cn={sourceId:'ajes_china_feed',sellerPriceRub:15_000_000};
 assert.equal(ajesChinaPriceAllowed(cn),true);
 assert.equal(ajesChinaPriceAllowed({...cn,sellerPriceRub:15_000_001}),false);
 assert.equal(ajesChinaPriceAllowed({...cn,sellerPriceRub:10_000_000,deliveredCalculationPreview:{totalRub:15_000_001}} as any),false);
 assert.equal(ajesChinaPriceAllowed({...cn,totalRub:28_788_043}),false);
 assert.equal(ajesChinaPriceAllowed({...cn,sourceId:'che168',totalRub:52_061_667}),true);
 const ceiling=ajesChinaSourceCeiling(12.34);
 assert.ok(ceiling*12.34<=15_000_000);assert.ok((ceiling+1)*12.34>15_000_000);
 for(const aggregate of [undefined,'count','makes','models'] as const)assert.match(ajesQuery({table:'china',sourcePriceTo:ceiling,aggregate}).sql,new RegExp('finish<='+ceiling));
 for(const value of [NaN,0,-1,Infinity])assert.throws(()=>ajesChinaSourceCeiling(value));
 assert.throws(()=>ajesQuery({table:'china',sourcePriceTo:1.2}));
 assert.throws(()=>ajesQuery({table:'korea',sourcePriceTo:123}));
});


test('China price ceiling can reuse a prior bounded page without reusing counts or other filters',async()=>{
 const {readUncappedChinaRows}=await import('../apps/web/lib/catalog/ajes-query-cache');
 const {ajesChinaPriceAllowed}=await import('../apps/web/lib/catalog/ajes-price-policy');
 const old=ajesQuery({table:'china',make:'BMW'}).sql;
 const capped=ajesQuery({table:'china',make:'BMW',sourcePriceTo:1000000}).sql;
 const value={items:[{table:'china',id:'old'}],observedAt:new Date().toISOString(),page:1,pageSize:24};
 const read=async(sql:string)=>sql===old?value:null;
 const result=await readUncappedChinaRows(capped,read);
 assert.equal(result.partial,true);assert.equal(result.schemaVersion,0);assert.deepEqual(result.items,value.items);
 assert.equal(await readUncappedChinaRows(ajesQuery({table:'china',aggregate:'count',sourcePriceTo:1000000}).sql,read),null);
 assert.equal(await readUncappedChinaRows(ajesQuery({table:'china',make:'TOYOTA',sourcePriceTo:1000000}).sql,read),null);
 assert.equal(await readUncappedChinaRows(old,read),null);
 assert.equal(ajesChinaPriceAllowed({sourceId:'ajes_china_feed',sellerPriceRub:52061667}),false);
});

test('confirmed supplier horsepower survives normalization and public safety checks',async()=>{
 const {normalizeVehicleOfferSpecs}=await import('../apps/web/lib/catalog/spec-normalization');
 const {safePublicPricing}=await import('../apps/web/lib/catalog/safe-public-pricing');
 const {classifySpecificationEvidence}=await import('../apps/web/lib/catalog/specification-evidence-audit');
 for(const power of ['100','150']){
  const lot=ajesLot({...row,MARKA_NAME:'TOYOTA',MODEL_NAME:'COROLLA',FINISH:'108000',PW:power,TIME:'P'},'china',false)!;
  const offer=ajesOffer(lot,{rateSource:'cbr',currency:'CNY',sourcePrice:108000,effectiveRate:12,rateDate:new Date().toISOString()} as any,new Date().toISOString());
  const normalized=normalizeVehicleOfferSpecs(offer);
  assert.equal(normalized.powerDataConfidence,'source_exact');
  assert.equal(classifySpecificationEvidence(normalized,'powerHp').state,'exact');
  assert.equal(safePublicPricing(normalized).powerHp,Number(power));
  assert.equal(normalized.power30MinKw,undefined);
 }
});


test('Korean detail requests full supplier information and does not accept a recent short detail as complete',async()=>{
 const lot=ajesLot(row,'korea',true)!;let request='',saved:any;
 const short={schemaVersion:2,items:[lot],page:1,pageSize:1,observedAt:new Date().toISOString()};
 const client=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>short,saveDetail:async(_t,_id,value)=>{saved=value;},fetcher:async url=>{request=String(url);return Response.json([{...row,PW:'150',ENG_V:'1968'}]);}});
 const result=await client.read({table:'korea',id:row.ID},'203.0.113.45');
 assert.equal(new URL(request).searchParams.has('ajax'),true);assert.equal(result.items[0].sourcePower,'150');assert.equal(result.items[0].engineCc,1968);assert.equal(saved.fullInformation,true);
 const cached=createAjesClient({password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{},readDetail:async()=>saved,fetcher:async()=>{throw Error('unexpected_request');}});
 assert.equal((await cached.read({table:'korea',id:row.ID},'203.0.113.45')).items[0].sourcePower,'150');
});

test('Rexton Sports keeps pickup identity when presentation shortens its model name',async()=>{
 const {catalogBodyType}=await import('../apps/web/lib/catalog/pickup-body');
 const {commercialParameters}=await import('../apps/web/lib/catalog/commercial-parameters');
 const lot=ajesLot({...row,MARKA_NAME:'SSANGYONG',MODEL_NAME:'REXTON SPORTS CAR',GRADE:'2.2 Diesel 4WD Coolmen Prestige'},'korea',true)!;
 const offer=ajesOffer(lot,{rateSource:'cbr',currency:'KRW',sourcePrice:17400000,effectiveRate:0.06} as any,'2026-10-24T13:30:12Z');
 const presented={...offer,model:'Rexton',trim:'2.2 Diesel 4WD Coolmen Prestige'};
 assert.equal(catalogBodyType(presented),'pickup');assert.equal(commercialParameters(presented).showCommercial,true);
 assert.match(presented.sourceTitle!,/REXTON SPORTS CAR/);assert.equal(presented.grossVehicleWeightKg,undefined);
 const suv=ajesOffer(ajesLot({...row,MARKA_NAME:'SSANGYONG',MODEL_NAME:'REXTON'},'korea',true)!,{rateSource:'cbr',currency:'KRW',sourcePrice:17400000,effectiveRate:0.06} as any,'2026-10-24');
 assert.notEqual(catalogBodyType(suv),'pickup');
});
