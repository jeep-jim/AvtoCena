import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesQuery,ajesLot,ajesCatalogQuery,ajesImageUrl} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer,ajesOfferId} from '../apps/web/lib/catalog/ajes-offer';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
const row={ID:'fixture001',MARKA_NAME:'HYUNDAI',MODEL_NAME:'TUCSON',YEAR:String(new Date().getUTCFullYear()-2),MONTH:'10',FINISH:'17400000',ENG_V:'1598',PW:'',TIME:'D',MILEAGE:'30000',SERIAL:'TESTFRAME123',IMAGES:'https://7.tru.ru/imgs/fixtureABC#https://7.tru.ru/imgs/fixtureDEF'};
test('stock SQL uses own table, six-year policy and no Japanese auction columns',()=>{
 for(const market of ['korea','china'] as const){const q=ajesQuery(ajesCatalogQuery({market,make:'HYUNDAI',model:'TUCSON',lotNumber:'00012'}));assert.match(q.sql,new RegExp('from '+market));assert.match(q.sql,/lot='00012'/);assert.doesNotMatch(q.sql,/auction_type|status='Sold'/);assert.match(q.sql,/finish>0/);assert.match(q.sql,new RegExp('year>='+ (new Date().getUTCFullYear()-6)));}
 assert.throws(()=>ajesQuery({table:'china',make:"x' OR 1=1"}));
 assert.throws(()=>ajesQuery({table:'korea',yearFrom:2008}));
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
