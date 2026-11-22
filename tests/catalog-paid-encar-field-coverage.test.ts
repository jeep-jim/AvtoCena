import assert from 'node:assert/strict';
import test from 'node:test';
import {paidEncarTechnicalCoverage, readPaidEncarTechnicalCoverage} from '../scripts/lib/paid-encar-field-coverage.mjs';

test('coverage separates retained system hp from unknown certified power bands', () => {
  const rows = [
    {powertrainKind:'combustion', powerHp:150, engineCc:1598, fuel:'petrol'},
    {powertrainKind:'other_hybrid', powerHp:227, engineCc:1598, fuel:'hybrid'},
    {powertrainKind:'electric', powerHp:204, fuel:'electric'},
    {powertrainKind:'series_hybrid', powerHp:136, engineCc:1198, fuel:'hybrid', utilizationPowerKw:100},
    {},
  ];
  const before = structuredClone(rows), result = paidEncarTechnicalCoverage(rows);
  assert.deepEqual(rows, before);
  const {byPowertrainKind, ...totals} = result;
  assert.deepEqual(totals, {rows:5, withPowerHp:4, withEngineCc:3, withFuel:4,
    withUtilizationPowerKw:1, hpPresentButPowerBandUnknown:2});
  assert.equal(byPowertrainKind.combustion.hpPresentButPowerBandUnknown, 0);
  assert.equal(byPowertrainKind.other_hybrid.withPowerHp, 1);
  assert.equal(byPowertrainKind.other_hybrid.hpPresentButPowerBandUnknown, 1);
  assert.equal(byPowertrainKind.electric.hpPresentButPowerBandUnknown, 1);
  assert.equal(byPowertrainKind.series_hybrid.withUtilizationPowerKw, 1);
  assert.equal(byPowertrainKind.series_hybrid.hpPresentButPowerBandUnknown, 0);
  assert.equal(byPowertrainKind.unknown.rows, 1);
  for (const key of Object.keys(totals)) {
    assert.equal(Object.values(byPowertrainKind).reduce((sum, bucket) => sum + bucket[key], 0), totals[key]);
  }
});

test('numeric coverage never coerces absent, nonpositive, nonfinite or nonnumeric values', () => {
  const invalid = [undefined, null, 0, -1, NaN, Infinity, -Infinity, '150', true, {}, new Number(150)];
  const rows = invalid.map(value => ({powerHp:value, engineCc:value, utilizationPowerKw:value}));
  rows.push({powerHp:0.1, engineCc:1.25, utilizationPowerKw:0.5});
  const result = paidEncarTechnicalCoverage(rows);
  assert.equal(result.rows, invalid.length + 1);
  assert.equal(result.withPowerHp, 1);
  assert.equal(result.withEngineCc, 1);
  assert.equal(result.withUtilizationPowerKw, 1);
  assert.equal(result.hpPresentButPowerBandUnknown, 0);
  const fuels = [null, undefined, '', '  ', false, 1, {}, [], 'petrol'];
  assert.equal(paidEncarTechnicalCoverage(fuels.map(fuel => ({fuel}))).withFuel, 1);
  assert.equal(paidEncarTechnicalCoverage([
    {powerHp:227, powertrainKind:'other_hybrid', utilizationPowerKw:'100'},
  ]).hpPresentButPowerBandUnknown, 1);
});

test('output stays bounded and never reads or exports identity, source, raw or private metadata', () => {
  const secret = 'private-example@example.invalid';
  const row = Object.freeze(Object.defineProperties({powerHp:150, powertrainKind:secret, fuel:'petrol'},
    Object.fromEntries(['id', 'sourceUrl', 'sourceOfferId', 'raw', 'operational'].map(key => [key, {
      get() {throw new Error('private field accessed: ' + key);},
    }]))));
  const result = paidEncarTechnicalCoverage([row, {powertrainKind:'__proto__'}, {powertrainKind:'constructor'}]);
  assert.deepEqual(Object.keys(result.byPowertrainKind),
    ['combustion', 'electric', 'series_hybrid', 'other_hybrid', 'unknown']);
  assert.equal(result.byPowertrainKind.unknown.rows, 3);
  assert.equal(result.withPowerHp, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-example|example\.invalid|sourceUrl|sourceOfferId|operational|raw/);
  for (const counts of [result, ...Object.values(result.byPowertrainKind)]) {
    for (const [key, value] of Object.entries(counts)) {
      if (key !== 'byPowertrainKind') assert.equal(typeof value, 'number');
    }
  }
});

test('empty input has zero coverage and invalid rows do not create technical data', () => {
  const empty = paidEncarTechnicalCoverage([]);
  assert.equal(empty.rows, 0);
  assert.equal(empty.withPowerHp, 0);
  assert.equal(empty.hpPresentButPowerBandUnknown, 0);
  assert.equal(paidEncarTechnicalCoverage([null, undefined, false, 42, 'row', []]).byPowertrainKind.unknown.rows, 6);
  assert.throws(() => paidEncarTechnicalCoverage(null), /paid_encar_coverage_rows_required/);
});

function readbackFixture(count = 7) {
  const generationId = 'gen_1795342198136_coverage';
  const rows = Array.from({length:count}, (_, index) => ({id:`private-id-${index}`, market:'korea',
    powertrainKind:index % 2 ? 'other_hybrid' : 'combustion', powerHp:150 + index, engineCc:1598,
    fuel:index % 2 ? 'hybrid' : 'petrol'}));
  const names = rows.map((_, index) => `chunk-${String(index + 1).padStart(4, '0')}`);
  const manifest = {version:2, generationId, updatedAt:'2026-11-22T12:00:00.000Z',
    markets:{korea:{provider:'auto_api_encar', count, chunks:names}}};
  const objects = new Map<string, unknown>(names.map((name, index) => [
    `catalog/generations/${generationId}/offers/korea/${name}.json`, [rows[index]],
  ]));
  const reads:string[] = [];
  let active = 0, maxActive = 0;
  const storage = {async readJson(key:string, fallback:unknown) {
    reads.push(key);
    if (key === 'catalog/manifest.json') return structuredClone(manifest);
    active++; maxActive = Math.max(maxActive, active);
    await new Promise<void>(resolve => setImmediate(resolve));
    active--;
    return structuredClone(objects.has(key) ? objects.get(key) : fallback);
  }};
  return {manifest, objects, rows, reads, storage, maxActive:() => maxActive};
}

test('fresh readback aggregates exact immutable Korea chunks with at most four concurrent reads', async () => {
  const f = readbackFixture();
  const result = await readPaidEncarTechnicalCoverage(f.storage, f.manifest);
  assert.deepEqual(result, {generationId:f.manifest.generationId, coverage:paidEncarTechnicalCoverage(f.rows)});
  assert.equal(f.reads[0], 'catalog/manifest.json');
  assert.equal(f.reads.at(-1), 'catalog/manifest.json');
  assert.equal(f.reads.filter(key => key === 'catalog/manifest.json').length, 2);
  assert.equal(f.maxActive(), 4);
  assert.deepEqual(new Set(f.reads.slice(1, -1)), new Set(f.objects.keys()));
  assert.doesNotMatch(JSON.stringify(result), /private-id|sourceUrl|operational/);
});

test('readback rejects a replaced or changed full manifest before and after chunk reads', async () => {
  for (const changeAt of [1, 2]) {
    for (const change of ['generation', 'market', 'other_metadata']) {
      const f = readbackFixture(1), read = f.storage.readJson.bind(f.storage);
      let manifests = 0;
      f.storage.readJson = async (key, fallback) => {
        const value:any = await read(key, fallback);
        if (key === 'catalog/manifest.json' && ++manifests === changeAt) {
          if (change === 'generation') value.generationId = 'gen_1795342198137_replaced';
          else if (change === 'market') value.markets.korea.provider = 'changed';
          else value.updatedAt = '2026-11-22T12:00:01.000Z';
        }
        return value;
      };
      await assert.rejects(readPaidEncarTechnicalCoverage(f.storage, f.manifest), /paid_encar_coverage_manifest_changed/);
      if (changeAt === 1) assert.deepEqual(f.reads, ['catalog/manifest.json']);
    }
  }
});

test('readback stops missing, invalid or incomplete chunks and wrong-market or duplicate identities', async () => {
  const cases = [
    {value:null, reason:'chunk_invalid'},
    {value:[], reason:'chunk_invalid'},
    {value:{items:[]}, reason:'chunk_invalid'},
    {value:[null], reason:'row_invalid'},
    {value:[{id:'foreign', market:'europe'}], reason:'row_invalid'},
    {value:[{id:'', market:'korea'}], reason:'row_invalid'},
    {value:[{id:' private ', market:'korea'}], reason:'row_invalid'},
    {value:[{id:'private-id-1', market:'korea'}], reason:'duplicate_id'},
    {value:Array.from({length:5001}, (_, index) => ({id:String(index), market:'korea'})), reason:'chunk_invalid'},
  ];
  for (const {value, reason} of cases) {
    const f = readbackFixture(2);
    f.objects.set([...f.objects.keys()][0], value);
    await assert.rejects(readPaidEncarTechnicalCoverage(f.storage, f.manifest), new RegExp('paid_encar_coverage_' + reason));
  }
  for (const delta of [-1, 1]) {
    const f = readbackFixture(2);
    f.manifest.markets.korea.count += delta;
    await assert.rejects(readPaidEncarTechnicalCoverage(f.storage, f.manifest), /paid_encar_coverage_count_mismatch/);
  }
});

test('readback accepts an explicit borrowed Korea chunk and rejects duplicate or out-of-scope paths', async () => {
  const f = readbackFixture(1), oldKey = [...f.objects.keys()][0];
  const borrowed = 'catalog/generations/gen_1795000000000_borrowed/offers/korea/chunk-0001.json';
  f.objects.set(borrowed, f.objects.get(oldKey)); f.objects.delete(oldKey);
  f.manifest.markets.korea.chunks = [borrowed];
  assert.equal((await readPaidEncarTechnicalCoverage(f.storage, f.manifest)).coverage.rows, 1);
  for (const chunk of ['../chunk-0001', 'catalog/current-projection/korea.json',
    borrowed.replace('/korea/', '/europe/')]) {
    const invalid = readbackFixture(1); invalid.manifest.markets.korea.chunks = [chunk];
    await assert.rejects(readPaidEncarTechnicalCoverage(invalid.storage, invalid.manifest), /paid_encar_coverage_chunk_path_invalid/);
    assert.deepEqual(invalid.reads, []);
  }
  const duplicate = readbackFixture(2);
  duplicate.manifest.markets.korea.chunks[1] = duplicate.manifest.markets.korea.chunks[0];
  await assert.rejects(readPaidEncarTechnicalCoverage(duplicate.storage, duplicate.manifest), /paid_encar_coverage_duplicate_chunk/);
});
