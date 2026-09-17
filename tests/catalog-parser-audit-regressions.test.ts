import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAutohomeExactConfigFields, autohomeNewSpecificationEvidence } from '../apps/web/lib/catalog/autohome-new-exact-source';
import { kcarKoreaExactSource, kcarSpecificationEvidence } from '../apps/web/lib/catalog/kcar-exact-source';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/parser-audit/autohome-ten-saved-cards.json', import.meta.url), 'utf8'));
function markup(groups: any[], specId: string) {
  return 'var config = ' + JSON.stringify({ result: { paramtypeitems: groups.map(g => ({ name: g.name,
    paramitems: g.items.map((item: any) => ({ name: item.name, valueitems: [{specid:specId,value:item.value}] })) })) } }) + ';';
}
test('ten real saved Autohome tables retain six exact displacements; electric cars gain no invented engine', () => {
  const expected: Record<string, number | undefined> = {77379:1498,74428:undefined,76091:1986,1022809:1999,
    75717:1498,78862:1497,1023901:undefined,1023367:undefined,77409:1499,78127:undefined};
  assert.equal(fixture.cards.length, 10);
  for (const card of fixture.cards) {
    assert.equal(card.beforeEngineCc, null);
    const parsed = parseAutohomeExactConfigFields(markup(card.groups, card.sourceOfferId), card.sourceOfferId)!;
    const evidence = autohomeNewSpecificationEvidence({...card.configFields, displacementCcValues:parsed.displacementCcValues});
    assert.equal(evidence.engineCc.value, expected[card.sourceOfferId], card.sourceOfferId);
    if (card.fuel !== 'petrol' && card.fuel !== 'diesel') assert.equal(evidence.powerHp.value, undefined, 'peak power must not become certified hybrid/EV power');
  }
});
test('unit-only displacement requires the engine section and matching specification ID', () => {
  const groups = [{name:'油箱',items:[{name:'(mL)',value:'1598'}]}, {name:'发动机',items:[{name:'(L)',value:'1.5'}]}];
  assert.deepEqual(parseAutohomeExactConfigFields(markup(groups,'123'),'123')!.displacementCcValues, []);
  groups.push({name:'发动机',items:[{name:'(mL)',value:'1498'}]});
  assert.deepEqual(parseAutohomeExactConfigFields(markup(groups,'123'),'456')!.displacementCcValues, []);
  groups[2].items.push({name:'排量(mL)',value:'1598'});
  const fields = parseAutohomeExactConfigFields(markup(groups,'123'),'123')!;
  assert.equal(autohomeNewSpecificationEvidence(fields).engineCc.status, 'conflict');
});
test('quarantined KCar power cannot advertise source_exact power provenance', () => {
  const before = process.env.CATALOG_SOURCE_INVENTORY_MODE;
  process.env.CATALOG_SOURCE_INVENTORY_MODE='1';
  try {
    const source = kcarKoreaExactSource;
    const evidence = kcarSpecificationEvidence({regModelYear:'2022',manufactureDate:'202205',fuelName:'가솔린',rawFuelType:'001',engineDisplacement:'1497',horsepower:'163'});
    const offer = source.normalizeOffer({id:'EC61408161',make:'KGM',model:'Tivoli',trim:'1.5',year:2022,sourcePrice:10000000,sourceCurrency:'KRW',
      images:['https://img.kcar.com/1.jpg','https://img.kcar.com/2.jpg'],fuel:'petrol',semanticEvidence:evidence});
    assert.ok(offer);
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.powerDataConfidence, undefined);
    assert.equal(offer.powerDataSource, undefined);
    assert.equal((offer.operational as any).semanticEvidence.powerHp.status, 'ambiguous');
  } finally { if (before === undefined) delete process.env.CATALOG_SOURCE_INVENTORY_MODE; else process.env.CATALOG_SOURCE_INVENTORY_MODE=before; }
});
