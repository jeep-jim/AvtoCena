import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSbtCardCandidates } from '../scripts/catalog-source-sbtjapan-japan-qualification-v2.mjs';

test('SBT v2 binds a source-declared detail URL to the fields inside the same listing anchor', () => {
  const html = `
    <a class="vehicle-card" href="/used-cars/AR0720">
      <span>2019/7 TOYOTA SUCCEED VAN HYBRID UL-X</span>
      <span>Vehicle Price USD 4,400</span>
      <span>Stock Id: AR0720</span>
      <span>Inventory location : YOKOHAMA, JAPAN</span>
      <span>NHP160V</span><span>191,000km</span><span>1,500cc</span>
      <span>AT</span><span>2WD</span><span>RHD</span><span>HYBRID(PETROL)</span>
    </a>
    <a href="/used-cars/search?page=2">Next</a>
  `;

  const rows = extractSbtCardCandidates(html, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stockId, 'AR0720');
  assert.equal(rows[0].url, 'https://www.sbtjapan.com/used-cars/AR0720');
  assert.equal(rows[0].list.yearMonth, '2019/7');
  assert.equal(rows[0].list.priceUsd, 4400);
  assert.equal(rows[0].list.engineCc, 1500);
  assert.equal(rows[0].list.fuel, 'HYBRID(PETROL)');
});

test('SBT v2 rejects a card whose visible Stock Id conflicts with its detail URL', () => {
  const html = `
    <a href="/used-cars/AR0720">
      2019/7 TOYOTA SUCCEED VAN HYBRID UL-X Vehicle Price USD 4,400
      Stock Id: AR9999 Inventory location : YOKOHAMA, JAPAN NHP160V 191,000km 1,500cc AT 2WD RHD HYBRID(PETROL)
    </a>
  `;

  assert.deepEqual(extractSbtCardCandidates(html, 10), []);
});
