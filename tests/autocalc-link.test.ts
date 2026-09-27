import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSource, sourceUrl, publicIPv4 } from '../apps/web/lib/autocalc/source';
import { autocalcScenario } from '../apps/web/lib/autocalc/scenario';
test('reject source challenge pages instead of using them as vehicle titles',()=>{
 for(const title of ['Pardon Our Interruption','Just a moment...','Access Denied'])assert.throws(()=>extractSource(`<title>${title}</title>`,'https://dubizzle.com/s/example'));
});
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

test('resolve JSON-LD graph references for offer, engine and photos',()=>{
 const graph={'@graph':[{'@type':'Car','@id':'https://dealer.example/car/7#car',name:'Test car',offers:{'@id':'#offer'},vehicleEngine:{'@id':'#engine'},image:[{'@id':'#image'}]},{'@type':'Offer','@id':'#offer',priceSpecification:{'@id':'#price'}},{'@id':'#price',price:13500,priceCurrency:'EUR'},{'@id':'#engine',engineDisplacement:{value:1598,unitCode:'CMQ'},enginePower:{value:82,unitCode:'KWT'}},{'@type':'ImageObject','@id':'#image',contentUrl:'/photos/car.jpg'}]};
 const d=extractSource(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`,'https://dealer.example/car/7');
 assert.equal(d.price,'13500');assert.equal(d.currency,'EUR');assert.equal(d.draft.engineCc,'1598');assert.equal(d.draft.powerKw,'82');assert.deepEqual(d.images,['https://dealer.example/photos/car.jpg']);
});
test('use explicit product price metadata without mixing recommended cars',()=>{
 const meta='<meta property="og:title" content="Dealer car"><meta property="product:price:amount" content="21000"><meta property="product:price:currency" content="AED"><meta name="twitter:image" content="/car.jpg">';
 const d=extractSource(meta,'https://dealer.example/car');assert.equal(d.price,'21000');assert.equal(d.currency,'AED');assert.equal(d.images[0],'https://dealer.example/car.jpg');
 const ambiguous=meta+'<script type="application/ld+json">[{"@type":"Car","url":"https://dealer.example/other"},{"@type":"Car","url":"https://dealer.example/another"}]</script>';
 assert.equal(extractSource(ambiguous,'https://dealer.example/car').price,'');assert.equal(extractSource(ambiguous,'https://dealer.example/car').currency,'');
});
