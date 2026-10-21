import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShowcase,calculateSpecial,normalizeShowcase,type SpecialOffer} from '../apps/web/lib/dealers/showcase-model';
import {deliveryDistance,estimateDealerDelivery,deliveryLocation,deliveryCalibrationError} from '../apps/web/lib/dealers/delivery-estimate';
import {selectCityShowcases} from '../apps/web/lib/dealers/public-showcase';
const s=defaultShowcase('dealer_topavto'),tariffs=s.pricing.tariffs;
test('delivery anchors are exact; new cities use calibrated geographic estimates',()=>{
 assert.equal(estimateDealerDelivery('Бишкек','Новосибирск',tariffs,true)?.usd,900);
 assert.equal(estimateDealerDelivery('Бишкек','Москва',tariffs,true)?.usd,1100);
 const estimate=estimateDealerDelivery('Бишкек','Красноярск',tariffs,true)!;
 const d=deliveryDistance('Бишкек','Красноярск')!,a=deliveryDistance('Бишкек','Новосибирск')!,b=deliveryDistance('Бишкек','Москва')!;
 assert.equal(estimate.usd,Math.round(900+200*(d-a)/(b-a)));assert.equal(estimate.estimated,true);
 assert.equal(estimate.daysFrom,5);assert.equal(estimate.daysTo,10);
 assert.equal(estimateDealerDelivery('Бишкек','Бишкек',tariffs,true)?.usd,0);
 assert.equal(estimateDealerDelivery('Бишкек','Красноярск',tariffs,false),null);
});
test('unknown or ambiguous locations and contradictory anchors do not invent delivery',()=>{
 assert.equal(deliveryLocation('Мирный'),null);
 assert.ok(deliveryLocation('Мирный, Саха /Якутия/ Респ'));
 assert.equal(estimateDealerDelivery('Бишкек','Неизвестный город',tariffs,true),null);
 assert.equal(estimateDealerDelivery('Неизвестный','Красноярск',tariffs,true),null);
 assert.equal(estimateDealerDelivery('Бишкек','Красноярск',tariffs.slice(0,1),true),null);
 assert.equal(estimateDealerDelivery('Бишкек','Красноярск',[tariffs[0],{...tariffs[1],usd:100}],true),null);
 assert.equal(estimateDealerDelivery('Бишкек','Красноярск',[tariffs[0],{...tariffs[0],id:'duplicate'}],true),null);
});
test('delivery uses current marked-up rate exactly once and stock stays fixed',()=>{
 const value=structuredClone(s);Object.assign(value.pricing,{usdRub:80,rateAt:new Date().toISOString()});
 const offer={id:'test',status:'draft' as const,trim:'',power30MinKw:0,fuel:'petrol' as const,transmission:'Автомат',drive:'Полный',body:'Кроссовер',color:'Белый',steering:'left' as const,mileageKm:0,description:'',equipment:'',photos:[],customsExtraRub:0,updatedAt:'',make:'Toyota',model:'RAV4',year:2026,productionMonth:1,engineCc:2000,powerHp:150,priceUsd:30000,customsIncluded:true,personalUseEligible:true,defaultCity:'Красноярск'};
 const c=calculateSpecial(value,offer);assert.ok(c.complete,c.errors.join(';'));
 const usd=estimateDealerDelivery('Бишкек','Красноярск',tariffs,true)!.usd;
 assert.equal(c.lines.find(l=>l.id==='delivery')?.amountRub,Math.round(usd*82.5+60000));assert.equal(c.city,'Красноярск');
 const normalized=normalizeShowcase(value,value.dealerId,1);assert.equal(normalized.pricing.originCity,'Бишкек');assert.equal(normalized.pricing.distancePricing,true);
 value.offices=[{id:'office',city:'Москва',address:'Адрес',phone:'',hours:'',lat:null,lon:null,photos:[]}];
 assert.equal(calculateSpecial(value,{...offer,availability:'stock',officeId:'office',priceRub:1000000}).totalRub,1000000);
});
test('pilot is nationwide alone; with other dealers only physical city matches',()=>{
 const pilot=structuredClone(s);pilot.offices=[{id:'nsk',city:'Новокузнецк',address:'Адрес',phone:'',hours:'',lat:null,lon:null,photos:[]}];
 const other={...defaultShowcase('other','Другой'),offices:[{...pilot.offices[0],city:'Москва'}]};
 assert.equal(selectCityShowcases([pilot],'Москва').length,1);
 assert.deepEqual(selectCityShowcases([pilot,other],'г. Москва').map(s=>s.dealerId),['other']);
 assert.deepEqual(selectCityShowcases([pilot,other],'Новосибирск'),[],'shipping destination is not dealer location');
 assert.equal(selectCityShowcases([pilot,other],'').length,2);
});

test('delivery calibration requires two priced known cities at least 100 km away',()=>{
 assert.ok(deliveryCalibrationError('Бишкек',tariffs.slice(0,1)));
 assert.ok(deliveryCalibrationError('Москва',[{...tariffs[0],city:'Москва'},tariffs[1]]));
 assert.ok(deliveryCalibrationError('Бишкек',[tariffs[0],{...tariffs[1],usd:0}]));
 assert.equal(deliveryCalibrationError('Бишкек',tariffs),null);
});
