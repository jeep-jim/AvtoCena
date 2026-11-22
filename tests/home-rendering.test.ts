import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {homeCardPayload} from '../apps/web/app/_lib/home-card-payload';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

type Row = {id: string; market: string; totalRub: number; [key: string]: unknown};
const offer = (id: string, market = 'korea'): Row => ({id, market, totalRub: 1_000_000,
  operational: {semanticEvidence: {powerHp: {status: 'verified', value: 150, provenance: [{source: 'private-reference'}]}}},
});
const snapshot = (items: Row[]) => ({items, marketCounts: {korea: 1, china: 1}, total: 400,
  marketCountInfo: {korea: {count: 1}}, countIncomplete: false, independentChina: true, generationId: 'generation'});

function load(path: string, inputs: {catalog: Promise<ReturnType<typeof snapshot>>; green: Promise<{items: Row[]} | null>;
  price: (rows: Row[]) => Promise<Row[]>}) {
  // Execute the actual server entrypoint with bounded local IO. JSX is kept as
  // an element tree so the assertions inspect the exact props sent to the client.
  const jsx = (type: unknown, props: unknown) => ({type, props});
  const mocks: Record<string, unknown> = {
    'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'}, react: {Suspense: 'Suspense'},
    '@/app/_lib/home-card-payload': {homeCardPayload},
    '@/lib/catalog/home-phase-timing': {createHomePhaseTiming: () => ({
      measure: (_name: string, work: () => unknown) => Promise.resolve().then(work), setGeneration() {},
    })},
    '@/lib/catalog/storage': {readHomeCatalogSnapshot: () => inputs.catalog,
      searchOffers: () => { throw Error('unexpected full-market recovery'); }},
    '@/lib/catalog/ajes-catalog': {withAjesCount: async (value: unknown) => value},
    '@/lib/catalog/green-corner': {readGreenCorner: () => inputs.green, publicGreenOffer: (row: Row) => row},
    '@/lib/catalog/live-business-pricing': {applyActiveBusinessPricingBatch: inputs.price},
    '@/lib/catalog/search-metadata': {WEBSITE_SCHEMA: {}},
    '@/lib/dealers/showcase-store': {readShowcase: async () => null},
    '@/lib/dealers/public-showcase': {homeSpecialRail: async () => null},
    'next/headers': {cookies: async () => ({get: () => ({value: encodeURIComponent('Томск')})})},
    'next/server': {NextResponse: {json: (body: unknown, options: unknown) => ({body, options})}},
    '@/components/home/HomePageClient': {__esModule: true, default: 'HomePageClient'},
    '@/components/home/BuyerGallery': {BuyerGallery: 'BuyerGallery'},
    '@/components/dealers/SpecialRail': {SpecialRail: 'SpecialRail'},
    '@/components/dealers/DealerCitySync': {DealerCitySync: 'DealerCitySync'},
    '@/components/catalog/AjesRail': {AjesRail: 'AjesRail', readAjesRailData: async () => null},
    './home.module.css': {__esModule: true, default: {scope: 'scope'}},
  };
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }}).outputText;
  const module = {exports: {} as any};
  new vm.Script(output, {filename: path}).runInNewContext({module, exports: module.exports, performance,
    console: {error() {}}, require: (name: string) => {
      assert.ok(Object.hasOwn(mocks, name), `unexpected dependency ${name}`);
      return mocks[name];
    }});
  return module.exports;
}

function clientProps(element: any): any {
  if (!element || typeof element !== 'object') return;
  if (element.type === 'HomePageClient') return element.props;
  for (const child of [element.props?.children].flat()) {
    const found = clientProps(child);
    if (found) return found;
  }
}

test('home starts catalog pricing while Green Corner is pending, preserving prepared China prices and totals', {timeout: 3000}, async () => {
  const green = deferred<{items: Row[]}>(), started = deferred<string[]>();
  const ordinary = offer('ordinary'), prepared = {...offer('prepared', 'china'),
    totalRub: 2_000_000, preparedChinaSelection: {generationId: 'china-generation'}};
  const page = load('apps/web/app/(public)/page.tsx', {catalog: Promise.resolve(snapshot([ordinary, prepared])),
    green: green.promise, price: async rows => { started.resolve(rows.map(row => row.id)); return rows.map(row => ({...row, totalRub: row.totalRub + 7})); }});
  let finished = false;
  const rendering = page.default({searchParams: Promise.resolve({city: '<Омск>'})}).then((value: unknown) => {finished = true; return value;});
  assert.deepEqual(await started.promise, ['ordinary']);
  assert.equal(finished, false);
  green.resolve({items: Array.from({length: 12}, (_, i) => offer(`green-${i}`, 'japan'))});
  const props = clientProps(await rendering);
  assert.equal(props.initialCity, 'Омск');
  assert.equal(props.initialCount, 412);
  assert.equal(props.initialGreen.total, 12);
  assert.equal(props.initialGreen.items.length, 10);
  assert.deepEqual(props.initialOffers.map((row: Row) => [row.id, row.totalRub]), [['ordinary', 1_000_007], ['prepared', 2_000_000]]);
  assert.equal(JSON.stringify(props.initialOffers).includes('private-reference'), false);
  assert.equal(JSON.stringify(props.initialGreen.items).includes('private-reference'), false);
  assert.equal(JSON.stringify(ordinary).includes('private-reference'), true);
  assert.equal(ordinary.totalRub, 1_000_000);
});

test('home starts Green Corner pricing while the catalog is pending', {timeout: 3000}, async () => {
  const catalog = deferred<ReturnType<typeof snapshot>>(), started = deferred<string[]>();
  const page = load('apps/web/app/(public)/page.tsx', {catalog: catalog.promise,
    green: Promise.resolve({items: [offer('green', 'japan')]}),
    price: async rows => {started.resolve(rows.map(row => row.id)); return rows;}});
  const rendering = page.default({});
  assert.deepEqual(await started.promise, ['green']);
  catalog.resolve(snapshot([]));
  const props = clientProps(await rendering);
  assert.equal(props.initialCity, 'Томск');
  assert.equal(props.initialGreen.items[0].id, 'green');
});

test('home retains the audited catalog quote when repricing fails and still removes private bibliography', async () => {
  const row = offer('retained');
  const page = load('apps/web/app/(public)/page.tsx', {catalog: Promise.resolve(snapshot([row])),
    green: Promise.resolve(null), price: async rows => {if (rows.length) throw Error('settings unavailable'); return rows;}});
  const props = clientProps(await page.default({}));
  assert.equal(props.initialOffers[0].totalRub, row.totalRub);
  assert.equal(props.initialCountIncomplete, true);
  assert.equal(JSON.stringify(props.initialOffers).includes('private-reference'), false);
  assert.equal(JSON.stringify(row).includes('private-reference'), true);
});

test('home API serializes priced rows without repricing prepared China or modifying stored evidence', async () => {
  const ordinary = offer('ordinary'), prepared = {...offer('prepared', 'china'), preparedChinaSelection: {generationId: 'china-generation'}};
  const pricedIds: string[][] = [];
  const route = load('apps/web/app/api/catalog/home/route.ts', {catalog: Promise.resolve(snapshot([ordinary, prepared])),
    green: Promise.resolve({items: [offer('green', 'japan')]}), price: async rows => {
      pricedIds.push(Array.from(rows, row => row.id)); return rows.map(row => ({...row, totalRub: row.totalRub + 7}));
    }});
  const response = await route.GET();
  assert.deepEqual(pricedIds, [['ordinary']]);
  assert.equal(response.body.total, 401);
  assert.deepEqual(Array.from(response.body.items, (row: Row) => [row.id, row.totalRub]), [['ordinary', 1_000_007], ['prepared', 1_000_000]]);
  assert.equal(response.options.headers['Cache-Control'], 'no-store, max-age=0');
  assert.equal(JSON.stringify(response.body.items).includes('private-reference'), false);
  assert.equal(JSON.stringify(ordinary).includes('private-reference'), true);
});
