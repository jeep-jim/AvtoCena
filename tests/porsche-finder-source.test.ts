import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { porscheFinderDetail } from '../apps/web/lib/catalog/porsche-finder-source';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/porsche-finder-bound-record.json', import.meta.url), 'utf8'));
function markup(record: any, product = fixture.product, extra: any[] = []) {
  const flight = '1:' + JSON.stringify([record, ...extra]) + '\n';
  return `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script><script type="application/ld+json">${JSON.stringify(product)}</script>`;
}
const parse = (r = fixture.record, p = fixture.product, extra: any[] = []) => porscheFinderDetail(markup(r, p, extra), fixture.source, 'uae');
test('Porsche uses one bound record, exact cc, power and real gallery; model year is not production date', () => {
  const offer = parse(); assert.ok(offer);
  assert.equal(offer.engineCc, 1984); assert.equal(offer.powerHp, 265); assert.equal(offer.powerKw, 195);
  assert.equal(offer.sourcePrice, 219000); assert.equal(offer.sourceCurrency, 'AED');
  assert.equal(offer.year, 2022); assert.equal(offer.productionDate, undefined);
  assert.equal(offer.images.length, 5);
  assert.equal(porscheFinderDetail(markup(fixture.record), fixture.source, 'georgia'), null);
});
test('Porsche rejects duplicate identity, stale/foreign price, power conflict, litres, renderings and hybrid peak power', () => {
  assert.equal(parse(fixture.record, fixture.product, [fixture.record]), null);
  const mutations = [
    (r: any) => { r.listed = false; },
    (r: any) => { r.meta.priceValue = 3327; },
    (r: any) => { r.meta.detailsUrl = r.meta.detailsUrl.replace('7062DL', 'EKE6O5'); },
    (r: any) => { r.sections.summary.characteristics[0].value = '280 kW / 380 hp'; },
    (r: any) => { r.sections.technicalData.technicalData[0].items.find((i: any) => i.label === 'Displacement').value = '2.0 l'; },
    (r: any) => { r.sections.gallery.imagesType = 'rendered'; },
    (r: any) => { r.sections.gallery.images.pop(); },
    (r: any) => { r.meta.engineType = 'HYBRID'; },
  ];
  for (const mutate of mutations) { const r = structuredClone(fixture.record); mutate(r); assert.equal(parse(r), null); }
});
test('Porsche unrelated Flight records cannot supply a missing metric', () => {
  const r = structuredClone(fixture.record); r.sections.technicalData.technicalData[0].items = [];
  const other = structuredClone(fixture.record); other.listingId = 'EKE6O5';
  assert.equal(parse(r, fixture.product, [other]), null);
});

test('Porsche returns collected details and stops at 429 without another source request', async () => {
  const { porscheFinderUaeSource } = await import('../apps/web/lib/catalog/porsche-finder-source');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(`<a href="${fixture.source}">car</a><a href="${fixture.source.replace('7062DL', 'EKE6O5')}">car</a><a href="${fixture.source.replace('7062DL', 'OTHER1')}">car</a>`);
    if (calls === 2) return new Response(markup(fixture.record));
    if (calls === 3) return new Response('rate limited', { status: 429 });
    throw new Error('unexpected request after stop');
  };
  try {
    const page = await porscheFinderUaeSource.fetchPage('1');
    assert.equal(calls, 3); assert.equal(page.items.length, 1); assert.equal(page.finished, true);
    assert.equal(page.diagnostics?.unexaminedRows, 1); assert.equal(page.diagnostics?.rejectedRows, 1);
    assert.equal(page.health?.ok, false);
    assert.match(page.health!.message!, /stopped:.*429/);
  } finally { globalThis.fetch = original; }
});
