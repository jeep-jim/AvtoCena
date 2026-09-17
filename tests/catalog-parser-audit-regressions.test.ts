import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAutohomeExactConfigFields, autohomeNewSpecificationEvidence } from '../apps/web/lib/catalog/autohome-new-exact-source';
import { kcarKoreaExactSource, kcarSpecificationEvidence } from '../apps/web/lib/catalog/kcar-exact-source';
import { CarSwitchUaeExactAdapter, parseCarSwitchExactDetail } from '../apps/web/lib/catalog/carswitch-exact-source';
import { AutoScoutHqAdapter, parseAutoScoutExactDetail } from '../apps/web/lib/catalog/autoscout-hq-source';

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

test('ten real CarSwitch vehicle entities retain transmission, drive and body without inventing engine cc', async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('./fixtures/parser-audit/carswitch-ten-detail-cards.json', import.meta.url), 'utf8')).cards;
  const originalFetch = globalThis.fetch;
  try {
    assert.equal(cards.length, 10);
    for (const card of cards) {
      const html = `<script type="application/ld+json">${JSON.stringify(card.entity)}</script>`;
      globalThis.fetch = async () => new Response(html);
      const row = parseCarSwitchExactDetail(html, card.sourceUrl)!;
      const source = new CarSwitchUaeExactAdapter();
      const offer = source.normalizeOffer(row)!;
      const refreshed = await source.refreshOffer(offer);
      assert.equal(refreshed.transmission, 'automatic', row.id);
      assert.equal(refreshed.drive, ({'Forward WD':'fwd','Rear WD':'rwd','4WD':'awd',AWD:'awd'} as any)[card.entity.driveWheelConfiguration], row.id);
      assert.equal(refreshed.bodyType, card.entity.bodyType.toLowerCase());
      assert.equal(refreshed.engineCc, undefined, 'rounded litres are not exact cc');
      assert.equal(refreshed.powerHp, undefined, 'no engine power in the vehicle entity');
      assert.equal(parseCarSwitchExactDetail(html, card.sourceUrl.replace(/\d+$/, '999999')), null);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('ten real AutoScout detail cards refresh named fields and cash price from the same listing', async () => {
  const cards = JSON.parse(fs.readFileSync(new URL('./fixtures/parser-audit/autoscout-ten-detail-cards.json', import.meta.url), 'utf8')).cards;
  const originalFetch = globalThis.fetch;
  const expectedPrices = [26470,34900,20900,40880,144999,20990,23880,21490,17890,19900];
  const expectedCc = [1498,undefined,999,1995,2981,1490,1995,999,1598,1498];
  try {
    assert.equal(cards.length, 10);
    for (const [i, card] of cards.entries()) {
      const row = parseAutoScoutExactDetail(card, card.id, card.webPage)!;
      assert.ok(row, card.id);
      const source = new AutoScoutHqAdapter();
      const offer = source.normalizeOffer(row)!;
      offer.sourcePrice = 1; // obsolete search price must not survive the detail fetch
      globalThis.fetch = async () => new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{listingDetails:card}}})}</script>`);
      const images = await source.fetchImages(offer);
      assert.ok(images.length >= 5, card.id);
      assert.equal(offer.sourcePrice, expectedPrices[i], card.id);
      assert.equal(offer.engineCc, expectedCc[i], card.id);
      assert.equal(offer.power30MinKw, undefined);
      assert.equal(offer.totalRub, null);
      assert.equal(parseAutoScoutExactDetail(card, 'foreign-id', card.webPage), null);
    }
    const c=cards[0];
    assert.equal(parseAutoScoutExactDetail({...c,status:'Deleted'},c.id,c.webPage),null);
    assert.equal(parseAutoScoutExactDetail({...c,price:{isConditionalPrice:true}},c.id,c.webPage),null);
    assert.equal(parseAutoScoutExactDetail({...c,prices:{public:{priceRaw:5,price:'$ 5'}}},c.id,c.webPage),null);
    const conflict = parseAutoScoutExactDetail({...c,vehicle:{...c.vehicle,rawPowerInKw:500}},c.id,c.webPage)!;
    assert.equal(conflict.semanticEvidence!.powerKw.status,'conflict');
  } finally { globalThis.fetch = originalFetch; }
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
