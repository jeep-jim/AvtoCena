import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter.ts';
import {JAPAN_STABILITY_CODE_SCOPE, JAPAN_STABILITY_CODE_PATHS, JAPAN_STABILITY_UI_CODE_PATHS,
  JAPAN_STABILITY_POWER_CODE_PATHS, JAPAN_STABILITY_RETAINED_RUNTIME,
  japanStabilityCodePaths, japanPowerOrderRequired, japanSourceNamesRequired, isExactJapanStabilityScope} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_PATHS} from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {checkedCatalogCodeScope} from '../scripts/catalog-next/photo-code-scope.mjs';
import {verifyChinaImageRuntime} from '../scripts/catalog-next/build-release-image.mjs';
import {JAPAN_PAGINATION_TEST_FILES, JAPAN_STABILITY_TEST_FILES} from '../scripts/catalog-next/check-photo-runtime-tests.mjs';
import {japanStabilityApiAllowed, japanStabilitySearchApi, JAPAN_STABILITY_MODELS_API,
  checkedJapanStabilityDirectory, selectJapanStabilityModel, verifyJapanStabilityModelRows,
  verifyJapanStabilityCombinedRows, verifyJapanStabilityRelated, validJapanStabilityGreenStock,
  verifyJapanLegacyMazdaThreeRows, runJapanLegacyMazdaThreeBrowser} from '../scripts/catalog-next/japan-stability-browser.mjs';
import {checkedJapanFilterDirectoryFixture, readJapanFilterDirectoryFixture} from '../scripts/catalog-next/japan-filter-directory-proof.mjs';
import {verifyJapanPage, verifyJapanPowerPage, verifyJapanVisibleVehiclePolicy, japanPageReadEvidence,
  recordJapanResponse, verifyJapanFullPage} from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const plan = () => ({codeScope: JAPAN_STABILITY_CODE_SCOPE, retainedRuntime: JAPAN_STABILITY_RETAINED_RUNTIME,
  runtimeFiles: [...JAPAN_STABILITY_CODE_PATHS]});
const directory = () => checkedJapanStabilityDirectory({version: 1, stale: false, models: [
  ['MAZDA', 'MAZDA3 FASTBACK', [], 20], ['MAZDA', 'AXELA 2WD', [], 12], ['MAZDA', 'TITAN 2WD', [], 5],
]}, 200);

test('stability source scope matches the reviewed manifest and keeps host and runner aligned', () => {
  assert.equal(JAPAN_STABILITY_RETAINED_RUNTIME, 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740');
  assert(Object.isFrozen(JAPAN_STABILITY_CODE_PATHS));
  assert.equal(new Set(JAPAN_STABILITY_CODE_PATHS).size, JAPAN_STABILITY_CODE_PATHS.length);
  const python = spawnSync('python3', ['-I', '-B', '-c',
    "import importlib.util,json; s=importlib.util.spec_from_file_location('h','scripts/catalog-next/release-host.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps({'scope':m.JAPAN_STABILITY_CODE_SCOPE,'retained':m.JAPAN_STABILITY_RETAINED,'files':sorted(m.JAPAN_STABILITY_CODE_FILES)}))"], {encoding: 'utf8'});
  assert.equal(python.status, 0, python.stderr);
  assert.deepEqual(JSON.parse(python.stdout), {scope: JAPAN_STABILITY_CODE_SCOPE,
    retained: JAPAN_STABILITY_RETAINED_RUNTIME, files: [...JAPAN_STABILITY_CODE_PATHS].sort()});
  if (JAPAN_STABILITY_CODE_PATHS.length === 0) {
    assert.equal(isExactJapanStabilityScope(plan()), false);
    assert.throws(() => checkedCatalogCodeScope(plan()), /stability_scope/);
  } else {
    for (const filename of JAPAN_PAGINATION_CODE_PATHS) assert(JAPAN_STABILITY_CODE_PATHS.includes(filename));
    assert(isExactJapanStabilityScope(plan()));
    assert.equal(checkedCatalogCodeScope(plan()), JAPAN_STABILITY_CODE_SCOPE);
    for (const filename of JAPAN_STABILITY_CODE_PATHS) {
      assert.equal(isExactJapanStabilityScope({...plan(), runtimeFiles: plan().runtimeFiles.filter(value => value !== filename)}), false);
    }
  }
});

test('stability image admission rejects foreign runtime scope before git or a build can run', async () => {
  for (const patch of [{retainedRuntime: '0'.repeat(40)}, {runtimeFiles: [...JAPAN_PAGINATION_CODE_PATHS]},
    {runtimeFiles: [...JAPAN_STABILITY_CODE_PATHS, 'packages/engine/src/index.ts']}]) {
    const candidate = {...plan(), version: 1, market: 'china', runtimeSha: '1'.repeat(40), runtimeTree: '2'.repeat(40),
      runtimeDiffSha256: '3'.repeat(64), ...patch};
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot: os.tmpdir(), plan: candidate,
      execute: () => assert.fail('invalid stability scope must fail before git')}), /china_image_(?:runtime_file_list|stability_scope)/);
  }
});

test('Japan source-name and preview repairs admit only the complete UI successor and retain the prior exact profile', async () => {
  const card='apps/web/components/catalog/CatalogCard.tsx';
  assert(Object.isFrozen(JAPAN_STABILITY_UI_CODE_PATHS));
  assert.equal(JAPAN_STABILITY_CODE_PATHS.length,49);
  assert.equal(JAPAN_STABILITY_UI_CODE_PATHS.length,52);
  assert.deepEqual(JAPAN_STABILITY_UI_CODE_PATHS.filter(name=>!JAPAN_STABILITY_CODE_PATHS.includes(name)),[
    'apps/web/components/catalog/BrandLogoRail.tsx',card,'apps/web/components/catalog/CatalogContent.tsx']);
  const candidate={...plan(),runtimeFiles:[...JAPAN_STABILITY_UI_CODE_PATHS]};
  assert(isExactJapanStabilityScope(candidate));
  assert.equal(checkedCatalogCodeScope(candidate),JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(japanStabilityCodePaths(candidate),JAPAN_STABILITY_UI_CODE_PATHS);
  assert.equal(japanStabilityCodePaths(plan()),JAPAN_STABILITY_CODE_PATHS);
  assert.equal(japanSourceNamesRequired(candidate),true);
  assert.equal(japanSourceNamesRequired(plan()),false);
  assert.equal(japanSourceNamesRequired({codeScope:'catalog-japan-pagination24-v1'}),false);
  const python=spawnSync('python3',['-I','-B','-c',
    "import importlib.util,json; s=importlib.util.spec_from_file_location('h','scripts/catalog-next/release-host.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(sorted(m.JAPAN_STABILITY_UI_CODE_FILES)))"],{encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);
  assert.deepEqual(JSON.parse(python.stdout),[...JAPAN_STABILITY_UI_CODE_PATHS]);
  for(const filename of JAPAN_STABILITY_UI_CODE_PATHS)
    assert.equal(isExactJapanStabilityScope({...candidate,runtimeFiles:candidate.runtimeFiles.filter(name=>name!==filename)}),false,filename);
  for(const patch of [{retainedRuntime:'0'.repeat(40)},
    {runtimeFiles:[...candidate.runtimeFiles,'packages/engine/src/index.ts']},
    {runtimeFiles:[...candidate.runtimeFiles,card]},
    {runtimeFiles:candidate.runtimeFiles.map(name=>name===card?'apps/web/components/catalog/Unreviewed.tsx':name)}]){
    const bad={...candidate,version:1,market:'china',runtimeSha:'1'.repeat(40),runtimeTree:'2'.repeat(40),runtimeDiffSha256:'3'.repeat(64),...patch};
    assert.equal(isExactJapanStabilityScope(bad),false);
    assert.throws(()=>japanSourceNamesRequired(bad),/source_names_scope/);
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot:os.tmpdir(),plan:bad,
      execute:()=>assert.fail('invalid UI successor must fail before git')}),/china_image_(?:runtime_file_list|stability_scope)/);
  }
});

test('ordered Japan power admits only its full snapshot-reader successor and requires its stronger fixture', async () => {
  const reader='apps/web/lib/catalog/ajes-public.ts';
  assert(Object.isFrozen(JAPAN_STABILITY_POWER_CODE_PATHS));
  assert.equal(JAPAN_STABILITY_POWER_CODE_PATHS.length,53);
  assert.deepEqual(JAPAN_STABILITY_POWER_CODE_PATHS.filter(name=>!JAPAN_STABILITY_UI_CODE_PATHS.includes(name)),[reader]);
  const candidate={...plan(),runtimeFiles:[...JAPAN_STABILITY_POWER_CODE_PATHS]};
  assert.equal(japanStabilityCodePaths(candidate),JAPAN_STABILITY_POWER_CODE_PATHS);
  assert.equal(checkedCatalogCodeScope(candidate),JAPAN_STABILITY_CODE_SCOPE);
  assert.equal(japanPowerOrderRequired(candidate),true);
  assert.equal(japanSourceNamesRequired(candidate),true);
  for(const runtimeFiles of [JAPAN_STABILITY_CODE_PATHS,JAPAN_STABILITY_UI_CODE_PATHS])
    assert.equal(japanPowerOrderRequired({...plan(),runtimeFiles:[...runtimeFiles]}),false);
  assert.equal(japanPowerOrderRequired({codeScope:'catalog-japan-pagination24-v1'}),false);
  const python=spawnSync('python3',['-I','-B','-c',
    "import importlib.util,json; s=importlib.util.spec_from_file_location('h','scripts/catalog-next/release-host.py'); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(json.dumps(sorted(m.JAPAN_STABILITY_POWER_CODE_FILES)))"],{encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);
  assert.deepEqual(JSON.parse(python.stdout),[...JAPAN_STABILITY_POWER_CODE_PATHS]);
  const invalid=[{retainedRuntime:'0'.repeat(40)},
    ...JAPAN_STABILITY_UI_CODE_PATHS.map(file=>({runtimeFiles:candidate.runtimeFiles.filter(name=>name!==file)})),
    {runtimeFiles:[...candidate.runtimeFiles,reader]},
    {runtimeFiles:[...candidate.runtimeFiles,'apps/web/lib/catalog/live-business-pricing.ts']}];
  for(const change of invalid){
    const bad={...candidate,version:1,market:'china',runtimeSha:'1'.repeat(40),runtimeTree:'2'.repeat(40),runtimeDiffSha256:'3'.repeat(64),...change};
    assert.equal(isExactJapanStabilityScope(bad),false);
    assert.throws(()=>japanPowerOrderRequired(bad),/power_order_scope/);
    assert.throws(()=>japanSourceNamesRequired(bad),/source_names_scope/);
    await assert.rejects(verifyChinaImageRuntime({runtimeRoot:os.tmpdir(),plan:bad,
      execute:()=>assert.fail('invalid power successor must fail before git')}),/china_image_(?:runtime_file_list|stability_scope)/);
  }
});

test('stability CI and publication retain required fixtures on the exact runtime before building or host contact', async () => {
  for(const filename of JAPAN_PAGINATION_TEST_FILES)assert(JAPAN_STABILITY_TEST_FILES.includes(filename),filename);
  for(const filename of JAPAN_STABILITY_CODE_PATHS.filter(value=>/^tests\/[^/]+\.test\.ts$/.test(value)))
    assert(JAPAN_STABILITY_TEST_FILES.includes(filename),filename);
  assert.equal(new Set(JAPAN_STABILITY_TEST_FILES).size,JAPAN_STABILITY_TEST_FILES.length);
  const verification=await fs.readFile('.github/workflows/verify-china-photo-code.yml','utf8');
  const publication=await fs.readFile('.github/workflows/catalog-next-china-photo-release.yml','utf8');
  for(const text of [verification,publication]){
    assert(text.includes('requirePowerOrder: japanPowerOrderRequired(plan)'));
    const steps=text.split('\n      - name: ');
    const directory=steps.find(value=>value.startsWith('Verify Japan supplier-only brand and model controls'));
    assert(directory);
    assert(directory.includes("if: steps.photo_scope.outputs.scope == 'catalog-japan-stability-v1'"));
    assert(directory.includes('cd "$RUNNER_TEMP/china-serving-runtime-$STABILITY_SHA"'));
    assert(directory.includes('JAPAN_FILTER_DIRECTORY_REPORT="$RUNNER_TEMP/japan-filter-directory-browser-report.json" node --import tsx tests/browser/japan-filter-directory.mjs'));
    assert(directory.includes('node --import tsx tests/browser/model-suggestions.mjs'));
    assert(directory.includes("await readJapanFilterDirectoryFixture(process.env.RUNNER_TEMP + '/japan-filter-directory-browser-report.json',"));
    assert(directory.includes('requireSourceNames: japanSourceNamesRequired(plan)'));
    assert(!directory.includes('continue-on-error')&&!directory.includes('|| true'));
    for(const fixture of ['tests/browser/collection-controls.mjs','tests/browser/catalog-photo-retry.mjs',
      'tests/browser/japan-catalog-city.mjs','tests/browser/ajes-pagination.mjs']){
      const step=steps.find(value=>value.includes(fixture));
      assert(step?.includes(JAPAN_STABILITY_CODE_SCOPE),fixture);
    }
    assert(text.includes('japan-filter-directory-browser-report.json'));
  }
  const fixtureAt=publication.indexOf('Verify Japan supplier-only brand and model controls');
  assert(fixtureAt<publication.indexOf('Build the verified source and check its image roundtrip'));
  assert(fixtureAt<publication.indexOf('Publish the code with existing China bytes and automatic rollback'));
  assert(publication.includes('node scripts/verify-frozen-speed-baselines.mjs'));
});

test('additional public API reads are only the three bounded visitor scenarios', () => {
  for (const value of [JAPAN_STABILITY_MODELS_API, japanStabilitySearchApi('model', 'MAZDA3 FASTBACK'),
    japanStabilitySearchApi('model', '3'), japanStabilitySearchApi('combined'), japanStabilitySearchApi('related', 'B-Class')]) {
    assert(japanStabilityApiAllowed(value));
    for (const suffix of ['&page=2', '&stock=green', '&model=Other', '&after=anything', '#private'])
      assert.equal(japanStabilityApiAllowed(value + suffix), false);
  }
  for (const value of ['/api/crm/china-catalog-status', 'https://supplier.example/query',
    JAPAN_STABILITY_MODELS_API.replace('Mazda', 'Toyota')]) assert.equal(japanStabilityApiAllowed(value), false);
});

test('a selectable model must be anchored to the actual Japan directory, not a global alias', () => {
  const rows = directory(), options = [{make: 'Mazda', model: 'AXELA'}, {make: 'Mazda', model: 'MAZDA3 FASTBACK'}];
  assert.deepEqual(selectJapanStabilityModel(rows, options), {make: 'Mazda', model: 'MAZDA3 FASTBACK'});
  assert.throws(() => selectJapanStabilityModel(rows, [...options, {make: 'Mazda', model: '3'}]), /model_not_in_source/);
  assert.throws(() => checkedJapanStabilityDirectory({version: 1, models: [], stale: false}, 200), /directory_unavailable/);
  assert.throws(() => checkedJapanStabilityDirectory({version: 1, models: [['MAZDA', '3', [], 1]], stale: true}, 200), /directory_unavailable/);
  const selected = {make: 'Mazda', model: 'AXELA'};
  assert.equal(verifyJapanStabilityModelRows({items: [{make: 'MAZDA', model: 'AXELA 2WD'}]}, selected, rows).rowModelsMatched, true);
  assert.throws(() => verifyJapanStabilityModelRows({items: [{make: 'MAZDA', model: 'MAZDA3 FASTBACK'}]}, selected, rows), /model_filter_mismatch/);
});

test('the literal Mazda/3 regression requires an observed MAZDA3 family and never substitutes AXELA or DEMIO', () => {
  const models = ['MAZDA3 FASTBACK', 'MAZDA 3 SEDAN', 'MAZDA3MPS'];
  const rows = models.map(model => ({model, total: 24}));
  const items = models.map(model => ({make: 'MAZDA', model}));
  assert.deepEqual(verifyJapanLegacyMazdaThreeRows({items}, rows), {make: 'Mazda', model: '3',
    resolvedFamily: 'MAZDA3', shown: 3, sourceFamilyModels: 3, rowModelsMatched: true});
  for (const model of [...models, 'MAZDA3', 'MAZDA 3', 'MAZDA3 (SEDAN)', 'MAZDA30', 'AXELA', 'CX-3', 'DEMIO', '3']) {
    const check = () => verifyJapanLegacyMazdaThreeRows({items: [{make: 'MAZDA', model}]}, [{model, total: 1}]);
    if (matchesCatalogModel(model, 'MAZDA3', 'Mazda')) assert.doesNotThrow(check, model);
    else assert.throws(check, /legacy_mazda_three_source_missing/, model);
  }
  for (const items of [[], [{make: 'Toyota', model: models[0]}], [{make: 'MAZDA', model: 'MAZDA3 UNKNOWN'}],
    [{make: 'MAZDA', model: 'AXELA'}], [{make: 'MAZDA', model: 'CX-3'}], [{make: 'MAZDA', model: 'DEMIO'}]])
    assert.throws(() => verifyJapanLegacyMazdaThreeRows({items}, rows), /legacy_mazda_three_mismatch/);
  assert.throws(() => verifyJapanLegacyMazdaThreeRows({items: [{make: 'MAZDA', model: 'DEMIO'}]},
    [{model: 'AXELA', total: 5}, {model: 'DEMIO', total: 24}]), /legacy_mazda_three_source_missing/);
});

const legacyNow = Date.parse('2026-11-27T03:00:00Z');
const legacyPage = () => ({ok: true, stale: false, partial: false, observedAt: new Date(legacyNow - 1000).toISOString(),
  hasMore: true, received: 24, items: Array.from({length: 24}, (_, index) => ({id: 'ajes-stats-M' + index,
    market: 'japan', make: 'MAZDA', model: 'MAZDA3 FASTBACK'}))});

function legacyJourney({payload = legacyPage(), status = 200, pageStatus = 200, source = directory(),
  uiIds = payload.items.map(row => row.id), javascriptError = false} = {}) {
  const calls = {navigate: [], read: [], stages: [], pages: [], captures: [], viewports: [], closed: 0, created: 0};
  let url, onError;
  const cards = {
    nth: index => ({waitFor: async () => assert(index >= 0)}),
    count: async () => uiIds.length,
    filter: ({has}) => ({waitFor: async () => {}, count: async () => uiIds.filter(id => has.selector === 'a[href*="' + id + '"]').length}),
  };
  const root = {locator: selector => {
    assert.equal(selector, 'article.ac-catalog-card,article.ac-catalog-list-row'); return cards;
  }, getByText: (text, options) => {
    assert.equal(text, 'Не удалось загрузить эту страницу'); assert.deepEqual(options, {exact: true});
    return {count: async () => 0};
  }};
  const view = {
    on: (event, callback) => { assert.equal(event, 'pageerror'); onError = callback; },
    setViewportSize: async value => { calls.viewports.push(value); },
    goto: async (value, options) => { calls.navigate.push({value, options}); url = value;
      if (javascriptError) onError(); return {status: () => pageStatus}; },
    url: () => url,
    locator: selector => selector === 'main.ac-ajes-catalog' ? root : {selector},
    close: async () => { calls.closed++; },
  };
  const run = () => runJapanLegacyMazdaThreeBrowser({
    context: {newPage: async () => { calls.created++; return view; }}, directory: source,
    read: async value => { calls.read.push(value); assert(japanStabilityApiAllowed(value)); return {data: payload, status}; },
    capture: async (page, name) => { assert.equal(page, view); calls.captures.push(name); },
    onStage: stage => { calls.stages.push(stage); }, onPage: page => { calls.pages.push(page); },
    verifyPage: (value, code) => verifyJapanPage(value, code, legacyNow), verifyFullPage: verifyJapanFullPage,
  });
  return {run, calls, view};
}

test('the legacy journey navigates the literal bookmark and performs exactly one existing allowed model=3 API read', async () => {
  const {run, calls, view} = legacyJourney();
  const result = await run();
  assert.deepEqual(calls.navigate, [{value: 'https://avtocena.com/cars/japan?' + new URLSearchParams({
    make: 'Mazda', model: '3', city: 'Новокузнецк'}), options: {waitUntil: 'domcontentloaded', timeout: 90_000}}]);
  assert.deepEqual(calls.read, [japanStabilitySearchApi('model', '3')]);
  assert.deepEqual(calls.stages, ['stability_legacy_mazda_three']);
  assert.deepEqual(calls.captures, ['japan-legacy-mazda-three-desktop']);
  assert.deepEqual(calls.viewports, [{width: 1440, height: 1000}]);
  assert.deepEqual(calls.pages, [view, null]); assert.equal(calls.created, 1); assert.equal(calls.closed, 1);
  assert.deepEqual(result.page, legacyPage());
  assert.equal(result.proof.shown, 24); assert.equal(result.proof.stale, false);
  assert.equal(result.proof.literalBookmarkChecked, true); assert.equal(result.proof.uiMatchesApi, true);
  assert.equal(result.proof.cityPreserved, true); assert.equal(result.proof.resolvedFamily, 'MAZDA3');
});

test('the literal journey keeps fresh/fullness/status and UI identity gates and fails honestly without MAZDA3', async () => {
  const fresh = legacyPage();
  const cases = [
    [{payload: {...fresh, stale: true}}, /unavailable_or_stale/],
    [{payload: {...fresh, partial: true}}, /unavailable_or_stale/],
    [{status: 503}, /japan_browser_http/],
    [{payload: {...fresh, items: [], hasMore: false}}, /japan_browser_rows/],
    [{payload: {...fresh, items: fresh.items.slice(0, 23)}}, /short_page_with_more/],
    [{payload: {...fresh, items: fresh.items.map(row => ({...row, model: 'AXELA'}))}}, /legacy_mazda_three_mismatch/],
    [{source: [{model: 'DEMIO', total: 24}]}, /legacy_mazda_three_source_missing/],
    [{uiIds: fresh.items.map((row, index) => index ? row.id : 'ajes-stats-Wrong')}, /ui_identity/],
    [{javascriptError: true}, /legacy_mazda_three_javascript/],
  ];
  for (const [options, error] of cases) {
    const {run, calls} = legacyJourney(options); await assert.rejects(run(), error);
    assert.equal(calls.navigate.length, 1); assert.deepEqual(calls.read, [japanStabilitySearchApi('model', '3')]);
    assert.equal(calls.captures.length, 0); assert.equal(calls.closed, 0);
  }
  const rejectedHttp = legacyJourney({pageStatus: 503});
  await assert.rejects(rejectedHttp.run(), /legacy_mazda_three_page_http/);
  assert.deepEqual(rejectedHttp.calls.read, []);
});

test('grade, fuel and transmission regression checks reject substituted or unfiltered cars', () => {
  const row = {fuel: 'petrol', transmission: 'automatic', auctionGrade: '5'};
  assert.equal(verifyJapanStabilityCombinedRows({items: [row]}).shown, 1);
  for (const patch of [{fuel: 'diesel'}, {transmission: 'cvt'}, {auctionGrade: '4.5'}])
    assert.throws(() => verifyJapanStabilityCombinedRows({items: [{...row, ...patch}]}), /combined_filter_mismatch/);
});

test('Japan recommendations require actual auction cards and the observed China identity', () => {
  const row = {id: 'ajes-stats-A1', market: 'japan', make: 'MERCEDES-BENZ', model: 'B180'};
  const payload = {kind: 'related', current: {id: 'china1', market: 'china'}, make: 'Mercedes-Benz', familyModel: 'B-Class',
    crossMarketGroups: [{market: 'japan', items: [row]}]};
  assert.deepEqual(verifyJapanStabilityRelated(payload, 200, 'china1'), [row]);
  assert.throws(() => verifyJapanStabilityRelated(payload, 200, 'other'), /related_response/);
  for (const items of [[], [{...row, market: 'china'}], [row, row], [{...row, id: 'green-1'}]])
    assert.throws(() => verifyJapanStabilityRelated({...payload, crossMarketGroups: [{market: 'japan', items}]}, 200, 'china1'));
});

test('fresh auction cards can share the Japan rail with source-bound Green stock invoice cards', () => {
  const auction={id:'ajes-stats-A1',market:'japan',make:'MERCEDES-BENZ',model:'B CLASS'};
  const stock={id:'green-700001',market:'japan',sourceId:'akebono_green_japan_open',offerType:'fixed',
    make:'Mercedes-Benz',model:'B-Class',catalogPricingMode:'seller',calculationStatus:'needs_data',
    totalRub:null,sellerPriceRub:225372,sourcePrice:408950,sourceCurrency:'JPY',images:[{url:'https://img.akebono.world/cars/fixture.jpg'}],
    calculationSnapshot:{currencyRate:{rateSource:'atb_akebono',currency:'JPY',sourcePrice:408950,effectiveRate:0.5511}}};
  const payload={kind:'related',current:{id:'china1',market:'china'},make:'Mercedes-Benz',familyModel:'B-Class',
    crossMarketGroups:[{market:'japan',items:[auction,stock]}]};
  assert.equal(validJapanStabilityGreenStock(stock),true);
  assert.deepEqual(verifyJapanStabilityRelated(payload,200,'china1'),[auction,stock]);
  for(const patch of [{sourceId:undefined},{sourceId:'ajes_japan_feed'},{offerType:'auction'},
    {sellerPriceRub:1},{sourcePrice:0},{sourceCurrency:'USD'},{images:[]},{vin:'PRIVATE'},
    {calculationSnapshot:{currencyRate:{...stock.calculationSnapshot.currencyRate,sourcePrice:1}}}]){
    const broken={...stock,...patch};assert.equal(validJapanStabilityGreenStock(broken),false);
    assert.throws(()=>verifyJapanStabilityRelated({...payload,crossMarketGroups:[{market:'japan',items:[auction,broken]}]},200,'china1'));
  }
  assert.throws(()=>verifyJapanStabilityRelated({...payload,crossMarketGroups:[{market:'japan',items:[stock]}]},200,'china1'));
  for(const model of ['B-Class','B CLASS SPORT','BCLASS','B-Class AMG','C-Class','B-Classical','B180']){
    const check=()=>verifyJapanStabilityRelated({...payload,crossMarketGroups:[{market:'japan',items:[auction,{...stock,model}]}]},200,'china1');
    if(matchesCatalogModel(model,'B-Class','Mercedes-Benz'))assert.doesNotThrow(check,model);
    else assert.throws(check,undefined,model);
  }
});

test('new checks retain the original stale, partial, power and vehicle rejection gates', () => {
  const now = Date.parse('2026-11-27T03:00:00Z');
  const row = {id: 'ajes-stats-A1', market: 'japan', make: 'Mazda', model: 'DEMIO', powerHp: 110};
  const payload = {ok: true, stale: false, observedAt: new Date(now - 1000).toISOString(), items: [row], total: 1,
    countSummary: {total: 1, upperBound: false}, powerFilterSummary: {shown: 1, localPower: 1, supplierPower: 0, unknownPower: 0}};
  assert.equal(verifyJapanPage(payload, 200, now).shown, 1); assert.equal(verifyJapanPowerPage(payload).localPower, 1);
  for (const patch of [{stale: true}, {partial: true}, {interrupted: true}, {observedAt: new Date(now - 1800000).toISOString()}])
    assert.throws(() => verifyJapanPage({...payload, ...patch}, 200, now));
  assert.throws(() => verifyJapanPowerPage({...payload, items: [{...row, powerHp: 180}]}), /local_power/);
  assert.throws(() => verifyJapanVisibleVehiclePolicy([{items: [{...row, model: 'TITAN 2WD'}]}]), /excluded_vehicle_visible/);
  assert.doesNotThrow(()=>verifyJapanVisibleVehiclePolicy([{items:[{market:'japan',make:'NISSAN',model:'TITAN',
    bodyType:'pickup',vehicleCategory:'N1',grossVehicleWeightKg:3400}]}]));
});

const receipt = (index = 1) => ({version: 1, requestId: '12345678-1234-4234-8234-' + String(index).padStart(12, '0'),
  queryHash: 'a'.repeat(64), table: 'stats', kind: 'list', page: index, pageSize: 24,
  startedAt: '2026-11-27T05:00:00.000Z', finishedAt: '2026-11-27T05:00:01.000Z', stage: 'supplier',
  supplierAttempted: true, outcome: 'stale', reason: 'http_500', observedAt: '2026-11-26T20:00:00.000Z'});

test('request-bound page receipts preserve the actual later failure without relabelling stale source data', () => {
  const first = {...receipt(), outcome: 'fresh'}, last = {...receipt(2), outcome: 'unavailable', reason: 'visitor_restricted',
    stage: 'access', supplierAttempted: false};
  const evidence = japanPageReadEvidence({sourceReceipts: [first, last]});
  assert.deepEqual(evidence.receipts, [first, last]); assert.equal(evidence.status, 'recorded');
  const report = {checks: {}};
  recordJapanResponse(report, 'combined', {data: {ok: false, sourceReceipt: last, reason: 'visitor_restricted'}, status: 503,
    requestedAt: Date.parse(last.startedAt), receivedAt: Date.parse(last.finishedAt), durationMs: 1000, headers: {}}, 'f'.repeat(40));
  assert.equal(report.checks.responses[0].pageReadEvidence.reason, 'visitor_restricted');
  assert.equal(report.checks.responses[0].pageReadEvidence.receipts[0].supplierAttempted, false);
  assert.deepEqual(japanPageReadEvidence({reason:'visitor_restricted'}),
    {status:'missing',receipts:[],received:0,omitted:0,limited:false,reason:'visitor_restricted'});
  assert.throws(() => verifyJapanPage({ok: true, stale: true, items: [], sourceReceipts: [first]}, 200), /unavailable_or_stale/);
});

test('page receipt projection rejects private fields and preserves the last failure when bounded', () => {
  let invoked = false;
  const accessor = {...receipt()}; Object.defineProperty(accessor, 'reason', {get() { invoked = true; return 'private'; }, enumerable: true});
  for (const value of [{...receipt(), sql: 'SELECT private'}, {...receipt(), reason: 'secret'}, accessor,
    {...receipt(), queryHash: 'private'}, {...receipt(), requestId: 'private'}, {...receipt(), observedAt: 'yesterday'}]) {
    assert.equal(japanPageReadEvidence({sourceReceipt: value}).receipts.length, 0);
  }
  assert.equal(invoked, false);
  const raw = Array.from({length: 20}, (_, index) => receipt(index + 1));
  raw[19] = {...raw[19], outcome: 'unavailable', reason: 'quota_busy'};
  const evidence = japanPageReadEvidence({sourceReceipts: raw});
  assert.equal(evidence.receipts.length, 16); assert.equal(evidence.omitted, 4); assert.equal(evidence.limited, true);
  assert.deepEqual(evidence.receipts.at(-1), raw.at(-1));
});

const fixture = () => ({passed: true,
  scope: 'Actual Japan brand/model controls with bounded local source fixtures; no production or supplier calls',
  cases: [390, 1440].flatMap(width => ['source-options-only', 'make-change-clears-old-models',
    'model-directory-failure-and-retry', 'brand-directory-failure-and-retry'].map(name => ({width, name, passed: true})))});

const sourceNamesFixture = () => ({...fixture(), cases: [390, 1440].flatMap(width => [
  'source-options-only', 'make-change-clears-old-models', 'model-directory-failure-and-retry',
  'brand-directory-failure-and-retry', 'raw-source-selection', 'typed-source-make-aliases',
].map(name => ({width, name, passed: true})))});

test('the required source-directory fixture needs all eight actual control cases, with no duplicate or missing case', () => {
  assert.deepEqual(checkedJapanFilterDirectoryFixture(fixture()), fixture());
  const duplicate = fixture(); duplicate.cases[1] = duplicate.cases[0];
  const failed = fixture(); failed.cases[5].passed = false;
  for (const value of [duplicate, failed, {...fixture(), cases: fixture().cases.slice(1)},
    {...fixture(), passed: false}, {...fixture(), error: 'private detail'}])
    assert.throws(() => checkedJapanFilterDirectoryFixture(value));
});

test('source-name successors require all twelve actual control cases without accepting the legacy proof', () => {
  const names = sourceNamesFixture();
  assert.deepEqual(checkedJapanFilterDirectoryFixture(names, {requireSourceNames: true}), names);
  assert.deepEqual(checkedJapanFilterDirectoryFixture(names), names);
  assert.throws(() => checkedJapanFilterDirectoryFixture(fixture(), {requireSourceNames: true}), /source_names_required/);
  for (const value of [null, 1, 'true']) {
    assert.throws(() => checkedJapanFilterDirectoryFixture(names, {requireSourceNames: value}));
  }
  const duplicate = sourceNamesFixture(); duplicate.cases[11] = duplicate.cases[0];
  const failed = sourceNamesFixture(); failed.cases[4].passed = false;
  const unknown = sourceNamesFixture(); unknown.cases[5].name = 'raw-source-looking-text';
  const wrongWidth = sourceNamesFixture(); wrongWidth.cases[4].width = 391;
  const stringWidth = sourceNamesFixture(); stringWidth.cases[4].width = '390';
  for (const value of [duplicate, failed, unknown, wrongWidth, stringWidth,
    {...names, cases: names.cases.slice(0, 11)}, {...names, cases: [...names.cases, names.cases[0]]}])
    assert.throws(() => checkedJapanFilterDirectoryFixture(value, {requireSourceNames: true}));
  let invoked = 0;
  const accessor = sourceNamesFixture();
  Object.defineProperty(accessor.cases[4], 'name', {enumerable: true, get() { invoked++; return 'raw-source-selection'; }});
  assert.throws(() => checkedJapanFilterDirectoryFixture(accessor, {requireSourceNames: true}));
  assert.equal(invoked, 0);
});

test('source-name fixture file validation cannot downgrade the required browser evidence', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-source-name-proof-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'fixture.json');
  await fs.writeFile(filename, JSON.stringify(fixture()));
  await assert.rejects(readJapanFilterDirectoryFixture(filename, {requireSourceNames: true}), /source_names_required/);
  await fs.writeFile(filename, JSON.stringify(sourceNamesFixture()));
  assert.deepEqual(JSON.parse(await readJapanFilterDirectoryFixture(filename, {requireSourceNames: true})), sourceNamesFixture());
});

test('fixture proof refuses links, oversized JSON and a failed browser run', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-stability-proof-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'fixture.json'); await fs.writeFile(filename, JSON.stringify(fixture()));
  assert.deepEqual(JSON.parse(await readJapanFilterDirectoryFixture(filename)), fixture());
  const linked = path.join(directory, 'linked.json'); await fs.symlink(filename, linked);
  await assert.rejects(readJapanFilterDirectoryFixture(linked), /japan_filter_directory_/);
  await fs.writeFile(filename, Buffer.alloc(16385, 32)); await assert.rejects(readJapanFilterDirectoryFixture(filename));
  await fs.writeFile(filename, JSON.stringify({...fixture(), passed: false})); await assert.rejects(readJapanFilterDirectoryFixture(filename));
});
