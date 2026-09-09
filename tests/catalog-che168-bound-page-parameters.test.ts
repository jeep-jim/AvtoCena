import test from 'node:test';
import assert from 'node:assert/strict';
import { che168BoundPageParameters } from '../apps/web/lib/catalog/che168-bound-page-parameters';
import { Che168GlobalExactAdapter } from '../apps/web/lib/catalog/che168-global-exact-source';
import { compactPublicStorageOffer, publicOffer } from '../apps/web/lib/catalog/storage';
const data = { carId: '59282752', initialSpecId: 32677, ssrSpecParam: [
  { name: 'Basic Specifications', paramitems: [{name:'Energy Type',value:'Gasoline'}] },
  { name: 'Engine', paramitems: [{name:'Displacement (mL)',value:'2356'}, {name:'Displacement (L)',value:'2.4'}, {name:'Maximum horsepower (Ps)',value:'208'}] },
  { name: 'Body', paramitems: [{name:'Length (mm)',value:'4981'}, {name:'Roof rails',value:'-'}, {name:'Optional equipment',value:'Panoramic roof'}] },
] };
function page(value: any) { return `<script>self.__next_f.push(${JSON.stringify([1,`20:${JSON.stringify(['$','$L24',null,value])}\n`])})</script>`; }
test('Che168 public table requires both listing and spec identity', () => {
  const result = che168BoundPageParameters(page(data),'59282752',32677)!;
  assert.equal(result.engineCc.value,2356);
  assert.equal(result.powerHp.value,208);
  assert.equal(che168BoundPageParameters(page(data),'59282753',32677),null);
  assert.equal(che168BoundPageParameters(page(data),'59282752',32678),null);
  assert.equal(che168BoundPageParameters(page([data,data]),'59282752',32677),null);
});
test('Che168 table ignores litre labels and unrelated groups, rejects conflicts', () => {
  const copy = structuredClone(data);
  copy.ssrSpecParam[1].paramitems = [{name:'Displacement (L)',value:'2.4'}];
  copy.ssrSpecParam.push({name:'Recommended engines',paramitems:[{name:'Displacement (mL)',value:'2356'}]});
  assert.equal(che168BoundPageParameters(page(copy),'59282752',32677)?.engineCc.status,'missing');
  copy.ssrSpecParam[1].paramitems = [{name:'Displacement (mL)',value:'2356'}, {name:'Displacement (mL)',value:'1998'}];
  assert.equal(che168BoundPageParameters(page(copy),'59282752',32677)?.engineCc.status,'conflict');
});
test('Che168 adapter uses its bound page table and retains provenance', async () => {
  const source = new Che168GlobalExactAdapter();
  const raw = { infoid:59282752, brandname:'Acura', seriesname:'Acura TLX-L', specname:'2021 2.4L', regdate:'2021-01', fuelname:'Gasoline', price:12000 };
  const offer = source.normalizeOffer(raw)!;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input).includes('/api/')
    ? new Response(JSON.stringify({returncode:0,result:{...raw,specid:32677,engine:'2.4L 208hp L4'}}),{status:200})
    : new Response(page(data),{status:200});
  try {
    await source.fetchImages(offer);
    assert.equal(offer.engineCc,2356);
    assert.equal(offer.powerHp,208);
    assert.equal((offer.operational.raw as any).boundPageParameters.specId,32677);
    assert.ok((offer.operational as any).semanticEvidence.engineCc.rawValues.includes('2.4L 208hp L4'));
    assert.ok((offer.operational as any).semanticEvidence.powerHp.rawValues.includes('2.4L 208hp L4'));
    assert.equal((offer.operational as any).semanticEvidence.engineCc.source,'che168_global_identity_bound_parameters');
    const stored = JSON.parse(JSON.stringify(compactPublicStorageOffer(offer)));
    assert.equal(stored.operational.raw, undefined);
    assert.equal(stored.operational.sourceSpecifications.specificationId, '32677');
    assert.equal(stored.operational.sourceSpecifications.sourceOfferId, '59282752');
    assert.deepEqual(stored.operational.sourceSpecifications.groups[2], { name:'Body', items:[
      {name:'Length (mm)',value:'4981'}, {name:'Roof rails',value:'-'}, {name:'Optional equipment',value:'Panoramic roof'},
    ] });
    assert.equal(stored.operational.specificationCollection.fieldCount, 7);
    // The large table remains on the detail record, not every list/search DTO.
    assert.equal((publicOffer(stored) as any).operational, undefined);
  } finally { globalThis.fetch = originalFetch; }
});


test('Che168 stops parameter page requests after a browser challenge while retaining public API evidence', async () => {
  const source = new Che168GlobalExactAdapter();
  const raw = { infoid:59282752, brandname:'Acura', seriesname:'Acura TLX-L', specname:'2021 2.4L', regdate:'2021-01', fuelname:'Gasoline', price:12000 };
  const offer = source.normalizeOffer(raw)!;
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async input => {
    calls.push(String(input).includes('/api/') ? 'public_api' : 'parameter_page');
    return String(input).includes('/api/')
      ? new Response(JSON.stringify({returncode:0,result:{...raw,specid:32677,engine:'2.4L208hpL4'}}),{status:200})
      : new Response('<script>window.solveChallenge("fixture");document.cookie="EO-Bot-Js-Token=fixture"</script>',{status:200});
  };
  try {
    await source.fetchImages(offer);
    await source.fetchImages(offer);
    assert.deepEqual(calls,['public_api','public_api','public_api','parameter_page','public_api']);
    assert.equal(offer.engineCc,undefined);
    assert.equal(offer.powerHp,208);
    assert.equal((offer.operational.raw as any).boundPageStatus,'browser_challenge');
    assert.equal(offer.operational.sourceSpecifications, undefined);
    assert.equal((offer.operational.specificationCollection as any).status, 'browser_challenge');
    assert.equal(offer.calculationStatus,'needs_data');
  } finally { globalThis.fetch = originalFetch; }
});


test('Che168 direct specification API restores exact cc and retains options for the linked spec only', async () => {
  const {readFileSync} = await import('node:fs');
  const {che168BoundApiParameters} = await import('../apps/web/lib/catalog/che168-bound-page-parameters');
  const parameters=JSON.parse(readFileSync(new URL('./fixtures/che168-specparam-74703.json',import.meta.url),'utf8'));
  const options=JSON.parse(readFileSync(new URL('./fixtures/che168-specconfig-74703.json',import.meta.url),'utf8'));
  const result=che168BoundApiParameters(parameters,options,'59769656',74703)!;
  assert.equal(result.engineCc.value,2998);
  assert.equal(result.powerHp.value,381);
  assert.ok(result.groups.some(group=>group.items.some(item=>item.value.includes('Tire pressure display'))));
  assert.equal(che168BoundApiParameters(parameters,options,'59769656',74704),null);
  const altered=structuredClone(options);
  altered.result.configtypeitems=[{name:'Foreign',configitems:[{name:'Wrong option',valueitems:[{specid:123,value:'wrong'}]}]}];
  assert.ok(!che168BoundApiParameters(parameters,altered,'59769656',74703)!.groups.some(group=>group.name==='Foreign'));
});


test('Che168 Russian specification API keeps exact units and matches English evidence', async () => {
 const {readFileSync}=await import('node:fs');
 const {che168BoundApiParameters}=await import('../apps/web/lib/catalog/che168-bound-page-parameters');
 const params=JSON.parse(readFileSync(new URL('./fixtures/che168-specparam-74703-ru.json',import.meta.url),'utf8'));
 const config=JSON.parse(readFileSync(new URL('./fixtures/che168-specconfig-74703-ru.json',import.meta.url),'utf8'));
 const result=che168BoundApiParameters(params,config,'59769656',74703)!;
 assert.equal(result.engineCc.value,2998);assert.equal(result.powerHp.value,381);
 assert.ok(result.groups.some(group=>group.name==='Пассивная безопасность'));
 assert.equal(result.fuelValues[0],'Бензин+48V мягкая гибридная система');
});
