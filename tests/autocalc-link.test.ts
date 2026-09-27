import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSource, sourceUrl, publicIPv4 } from '../apps/web/lib/autocalc/source';
import { autocalcScenario } from '../apps/web/lib/autocalc/scenario';
test('reject internal URLs, credentials, non-https and private DNS addresses',()=>{
 for(const url of ['https://127.0.0.1','https://[::1]','https://2130706433','http://example.com','https://a:b@example.com','https://example.com:444','https://metadata.internal'])assert.throws(()=>sourceUrl(url));
 for(const ip of ['127.1.2.3','10.1.1.1','169.254.169.254','172.16.0.1','192.168.1.2','100.64.0.1','::1','224.0.0.1'])assert.equal(publicIPv4(ip),false,ip);
 assert.equal(publicIPv4('8.8.8.8'),true);
});
test('extract explicit vehicle fields without guessing production date or hybrid power',()=>{
 const car={'@type':'Car',name:'Toyota test',vehicleModelDate:'2025',productionDate:'2024-12',fuelType:'Hybrid',vehicleEngine:{engineDisplacement:{value:1.8,unitCode:'LTR'},enginePower:{value:103,unitCode:'KWT'}},offers:{price:12000,priceCurrency:'USD'},image:['https://example.com/car.jpg']};
 const data=extractSource(`<script type="application/ld+json">${JSON.stringify(car)}</script>`,'https://myauto.ge/car/123');
 assert.equal(data.market,'georgia');assert.equal(data.price,'12000');assert.equal(data.draft.year,'2024');assert.equal(data.draft.engineCc,'1800');assert.equal(data.draft.fuel,'hybrid');assert.equal(data.draft.power30MinKw,undefined);assert.equal(data.draft.icePowerKw,undefined);
 delete (car as any).productionDate;
 assert.equal(extractSource(`<script type="application/ld+json">${JSON.stringify(car)}</script>`,'https://example.com').draft.year,undefined);
});
test('do not mix price from multiple vehicle objects',()=>{
 const data=extractSource('<script type="application/ld+json">[{"@type":"Car","offers":{"price":1000}},{"@type":"Car","offers":{"price":2000}}]</script>','https://example.com');assert.equal(data.price,'');
});
test('manual scenario validates inputs and never trusts totals from client',()=>{
 const base={title:'Toyota Corolla',market:'georgia',price:'15000',currency:'USD',city:'Новокузнецк',draft:{vehicleCategory:'M1',year:'2022',fuel:'petrol',engineCc:'1800',powerHp:'140'}};
 const {offer}=autocalcScenario({...base,totalRub:1});assert.equal(offer.totalRub,undefined);assert.equal(offer.sourcePrice,15000);assert.equal(offer.sourceId,'manual_link');
 for(const change of [{draft:{...base.draft,vehicleCategory:''}},{market:'unknown'},{price:0},{currency:'INVALID'},{city:''},{draft:{...base.draft,powerHp:''}},{draft:{...base.draft,fuel:'hybrid'}}])assert.throws(()=>autocalcScenario({...base,...change}));
});
