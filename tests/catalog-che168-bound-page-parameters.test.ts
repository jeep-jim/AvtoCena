import test from 'node:test';
import assert from 'node:assert/strict';
import { che168BoundPageParameters } from '../apps/web/lib/catalog/che168-bound-page-parameters';
import { Che168GlobalExactAdapter } from '../apps/web/lib/catalog/che168-global-exact-source';
const data = { carId: '59282752', initialSpecId: 32677, ssrSpecParam: [
  { name: 'Basic Specifications', paramitems: [{name:'Energy Type',value:'Gasoline'}] },
  { name: 'Engine', paramitems: [{name:'Displacement (mL)',value:'2356'}, {name:'Displacement (L)',value:'2.4'}, {name:'Maximum horsepower (Ps)',value:'208'}] },
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
  } finally { globalThis.fetch = originalFetch; }
});
