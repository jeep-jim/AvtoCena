import test from 'node:test';
import assert from 'node:assert/strict';
import { DongchediPublicSource, dongchediPublicSource, parseDongchediPublicListings } from '../apps/web/lib/catalog/dongchedi-public-source';
import { catalogImportSources } from '../apps/web/lib/catalog/importer';

const car = { '@type':'Car', url:'https://www.dongchedi.com/usedcar/12345678',
  brand:{name:'Toyota'},model:'Corolla',vehicleModelDate:'2023',name:'Corolla',
  image:['https://p3.dcarimg.com/car-one.jpg'],offers:{price:80000,priceCurrency:'CNY'} };
const jsonld = (value:unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

test('production registry uses the public reader rather than the permanent restriction stub', () => {
  assert.equal(catalogImportSources.find(s=>s.sourceId==='dongchedi_china_open'),dongchediPublicSource);
  assert.equal(dongchediPublicSource.accessMode,'public_html');
});
test('live login redirect stops after exactly one request, without following or authenticating', async () => {
  const old=global.fetch;let calls=0;
  global.fetch=async (url,init)=>{calls++;assert.equal(String(url),'https://www.dongchedi.com/usedcar');assert.equal(init?.redirect,'manual');
    return new Response('',{status:302,headers:{location:'/login-required?redirect=%2Fusedcar'}});};
  try {const p=await new DongchediPublicSource().fetchPage();assert.equal(p.health?.blocked,true);assert.equal(p.health?.httpStatus,302);
    assert.match(p.health!.message,/live_login_required/);assert.equal(p.nextCursor,null);assert.equal(calls,1);}
  finally {global.fetch=old;}
});
for(const [body,status] of [['<script>secsdk-captcha</script>',200],['Denied',403]] as const) {
  test(`actual challenge/HTTP ${status} remains blocked without fallback`, async () => {
    const old=global.fetch;let calls=0;global.fetch=async()=>{calls++;return new Response(body,{status});};
    try{const p=await new DongchediPublicSource().fetchPage();assert.equal(p.health?.blocked,true);assert.equal(calls,1);assert.deepEqual(p.items,[]);}
    finally{global.fetch=old;}
  });
}
test('empty or unrecognized public HTML is a parser failure, never successful coverage', async()=>{
  const old=global.fetch;global.fetch=async()=>new Response('<html>App shell</html>');
  try{await assert.rejects(new DongchediPublicSource().fetchPage(),/listing_schema_unrecognized/);}
  finally{global.fetch=old;}
});
test('synthetic standard JSON-LD contract keeps seller price and bound gallery without invented specifications',async()=>{
  const old=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return new Response('<a href="/login-required?redirect=x">Login</a>'+jsonld({'@type':'ItemList',itemListElement:[{item:car},
    {item:{...car,url:'https://example.com/usedcar/999999'}},
    {item:{...car,url:'https://www.dongchedi.com/auto/series/123'}}]}));};
  try {const source=new DongchediPublicSource(),page=await source.fetchPage();assert.equal(page.items.length,1);
    const offer=source.normalizeOffer(page.items[0])!;assert.equal(offer.sourcePrice,80000);assert.equal(offer.sourceCurrency,'CNY');
    assert.equal(offer.powerHp,undefined);assert.equal(offer.engineCc,undefined);assert.equal(offer.calculationStatus,'needs_data');
    const images=await source.fetchImages(offer);assert.equal(images[0].url,car.image[0]);assert.equal(images[0].objectKey,'');assert.equal(calls,1);
    assert.equal(source.normalizeOffer({...car,offers:{...car.offers,url:'https://www.dongchedi.com/usedcar/999999'}}),null);
    assert.equal(source.normalizeOffer({...car,offers:{price:80000,priceCurrency:'USD'}}),null);
    assert.equal(source.normalizeOffer({...car,offers:undefined,msrp:80000}),null);
  } finally {global.fetch=old;}
});
test('conflicting duplicate listing payloads cannot silently choose one seller price',()=>{
  const changed={...car,offers:{...car.offers,price:90000}};
  assert.deepEqual(parseDongchediPublicListings(jsonld({'@graph':[car,changed]})),[]);
  assert.equal(parseDongchediPublicListings(jsonld({'@graph':[car,car]})).length,1);
});
