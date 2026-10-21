import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ajesOriginalListingUrl} from '../apps/web/lib/catalog/ajes-source-url';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
test('original STATUS link reaches existing operational source slot without changing price',()=>{
 for(const [market,url,price,rate] of [
  ['korea','http://www.encar.com/dc/dc_cardetailview.do?carid=12345678',17400000,0.06],
  ['china','https://www.che168.com/dealer/490679/59163228.html',57800,12.495],
 ] as const){
  const row={ID:'fixture01',MARKA_NAME:'TEST',MODEL_NAME:'TEST',YEAR:2023,FINISH:price,STATUS:url,TIME:'P',ENG_V:1497,PW:150};
  const lot=ajesLot(row,market,true)!;
  const offer=ajesOffer(lot,{rateSource:'cbr',currency:market==='china'?'CNY':'KRW',sourcePrice:price,effectiveRate:rate} as any,'2026-10-19T00:00:00Z');
  assert.equal(offer.operational?.sourceUrl,url);
  assert.equal(offer.sourcePrice,price);
  assert.equal(offer.sellerPriceRub,Math.round(price*rate));
  assert.equal(offer.powerHp,150);
  // A pre-fix normalized snapshot also has STATUS: no schema reset or forced upstream call.
  assert.equal(ajesOffer(JSON.parse(JSON.stringify(lot)),{rateSource:'cbr',currency:offer.sourceCurrency,sourcePrice:price,effectiveRate:rate} as any,'2026-10-19').operational?.sourceUrl,url);
 }
});
test('missing, withdrawn and unsafe sources are never invented or turned into links',()=>{
 for(const value of [undefined,'','Sold','removed','123','javascript:alert(1)','https://www.encar.com.evil.test/x','https://evil.test/?next=https://encar.com','https://user:password@encar.com/x','https://encar.com:8443/x','https://encar.com/x?code=private','https://127.0.0.1/x','//encar.com/x']){
  assert.equal(ajesOriginalListingUrl(value,'korea'),undefined);
 }
 assert.equal(ajesOriginalListingUrl('https://www.encar.com/x','china'),undefined);
 assert.equal(ajesOriginalListingUrl('https://www.encar.com/x','stats'),undefined);
 assert.equal(ajesOriginalListingUrl('https://www.encar.com/x?a=1&amp;b=2','korea'),'https://www.encar.com/x?a=1&b=2');
 assert.equal(ajesLot({ID:'fixture01',MARKA_NAME:'TEST',MODEL_NAME:'TEST',YEAR:2023,FINISH:100,STATUS:'Sold'},'china',true),null);
});
test('Haval screenshot difference is seller price plus existing 2.2 percent reserve',()=>{
 const rate=12.495,oldPrice=53800*rate,newPrice=57800*rate;
 assert.equal(oldPrice,672231);assert.equal(newPrice,722211);
 assert.equal(newPrice-oldPrice,49980);
 assert.equal(Math.round(newPrice*.022)-Math.round(oldPrice*.022),1100);
});

test('supplier STATUS template uses only this record LOT and never leaves a broken placeholder',()=>{
 assert.equal(ajesOriginalListingUrl('http://www.encar.com/dc/dc_cardetailview.do?carid={LOT}','korea','12345678'),'http://www.encar.com/dc/dc_cardetailview.do?carid=12345678');
 assert.equal(ajesOriginalListingUrl('https://m.che168.com/cardetail/index?infoid={LOT}','china','59163228'),'https://m.che168.com/cardetail/index?infoid=59163228');
 for(const lot of [undefined,'','x&code=secret','../x','{LOT}'])assert.equal(ajesOriginalListingUrl('https://m.che168.com/cardetail/index?infoid={LOT}','china',lot),undefined);
 const lot=ajesLot({ID:'fixture',MARKA_NAME:'HAVAL',MODEL_NAME:'M6',YEAR:2023,FINISH:57800,STATUS:'https://m.che168.com/cardetail/index?infoid={LOT}',LOT:'59163228'},'china',true)!;
 assert.equal(ajesOffer(lot,{rateSource:'cbr',currency:'CNY',sourcePrice:57800,effectiveRate:12.495} as any,'2026-10-19').operational?.sourceUrl,'https://m.che168.com/cardetail/index?infoid=59163228');
});

test('named INFO technical table fills only explicit missing parameters and retains source binding',()=>{
 const INFO='<script>Maximum horsepower (Ps): 999</script>Seller phone: 1234567<br>Maximum horsepower (Ps): 150<br>Displacement (mL): 1497<br>fuel form: Gasoline<br>Drive mode: FF<br>gearbox: 6-speed Manual<br>Body structure: Unibody<br>Body structure: 5-door 5 Seats SUV<br>Body structure: SUV<br>engine model: GW4G15M<br>Maximum net power (kW): 105<br>Maximum power(kW): 110<br>Length (mm): 4664';
 for(const detail of [false,true]){
  const lot=ajesLot({ID:'fixture',MARKA_NAME:'HAVAL',MODEL_NAME:'M6',YEAR:2023,FINISH:57800,STATUS:'https://m.che168.com/cardetail/index?infoid={LOT}',LOT:'59163228',INFO},'china',detail)!;
  const offer=ajesOffer(lot,{rateSource:'cbr',currency:'CNY',sourcePrice:57800,effectiveRate:12.495} as any,'2026-10-19');
  assert.equal(offer.sourcePrice,57800);assert.equal(offer.sellerPriceRub,722211);
  assert.equal(offer.powerHp,150);assert.equal(offer.engineCc,1497);assert.equal(offer.fuel,'petrol');assert.equal(offer.drive,'fwd');assert.equal(offer.transmission,'manual');assert.equal(offer.bodyType,'suv');
  assert.match(offer.powerDataSource!,/INFO:Maximum horsepower/);
  assert.equal(offer.power30MinKw,undefined);
  const snapshot=offer.operational?.sourceSpecifications;assert.equal(snapshot?.sourceOfferId,'fixture');assert.equal(snapshot?.sourceId,'ajes_china_feed');
  assert.ok(snapshot?.groups[0].items.some(i=>i.value==='GW4G15M'));
  assert.doesNotMatch(JSON.stringify(snapshot),/1234567|999|script|Seller phone/);
 }
});
test('INFO cannot override present core parameters or fabricate power from peak kW',()=>{
 const row={ID:'fixture',MARKA_NAME:'TEST',MODEL_NAME:'TEST',YEAR:2023,FINISH:57800,PW:'160',ENG_V:1998,TIME:'D',KPP:'AT',PRIV:'4WD',INFO:'Maximum horsepower (Ps): 150<br>Displacement (mL): 1497<br>fuel form: Gasoline<br>gearbox: 6-speed Manual<br>Drive mode: FF'};
 const rate={rateSource:'cbr',currency:'CNY',sourcePrice:57800,effectiveRate:12.495} as any;
 const offer=ajesOffer(ajesLot(row,'china',true)!,rate,'2026-10-19');
 assert.equal(offer.powerHp,160);assert.equal(offer.engineCc,1998);assert.equal(offer.fuel,'diesel');assert.equal(offer.transmission,'automatic');assert.equal(offer.drive,'awd');
 const ambiguous=ajesOffer(ajesLot({...row,PW:'',INFO:'Maximum horsepower (Ps): 150<br>Maximum horsepower (Ps): 180<br>Maximum power(kW): 110'},'china',true)!,rate,'2026-10-19');
 assert.equal(ambiguous.powerHp,undefined);assert.equal(ambiguous.power30MinKw,undefined);
 const missing=ajesOffer(ajesLot({...row,PW:'',INFO:'Maximum power(kW): 110'},'china',true)!,rate,'2026-10-19');assert.equal(missing.powerHp,undefined);
});
