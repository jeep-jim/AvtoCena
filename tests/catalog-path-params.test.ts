import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {canonicalCatalogHref, catalogRouteParams, catalogSearchHeading, decodeCatalogPathParams} from '../apps/web/lib/catalog/catalog-routes';
import {matchesCatalogModel} from '../apps/web/lib/catalog/model-filter';

const require = createRequire(import.meta.url);
const {getRouteMatcher} = require('next/dist/shared/lib/router/utils/route-matcher');
const {getRouteRegex} = require('next/dist/shared/lib/router/utils/route-regex');
const {getDynamicParam} = require('next/dist/shared/lib/router/utils/get-dynamic-param');
const modelRoute = '/cars/[market]/[make]/[model]';
const makeRoute = '/cars/[market]/[make]';

// Exercise the installed framework's path -> route match -> page params contract.
// Testing only our URL helper misses Next's second encoding boundary.
function pageParams(pathname: string, route = modelRoute) {
  const matched = getRouteMatcher(getRouteRegex(route))(pathname);
  assert.ok(matched, pathname);
  return Object.fromEntries(Object.keys(matched).map(key => [key, getDynamicParam(matched, key, 'd', route, null).value]));
}

async function loadPage(route: string) {
  const result = await build({
    entryPoints: [`apps/web/app/(public)${route}/page.tsx`],
    bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external',
    plugins: [{name: 'catalog-read-boundary', setup(builder) {
      // Keep the real page wrapper and metadata, but do not read inventory/storage.
      builder.onResolve({filter: /^(?:\.\.\/){2,3}page$/}, () => ({path: 'cars-page', namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({
        contents: 'export default async function CarsPage({searchParams}) { return await searchParams; }', loader: 'ts',
      }));
    }}],
  });
  const module = {exports: {} as any};
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

test('BMW spaced model survives framework page params, search, filter acknowledgement and metadata', async () => {
  const pathname = '/cars/china/BMW/3%20SERIES';
  const params = pageParams(pathname);
  const selection = {powerTo: '160', sort: 'totalRub', city: 'Москва', dealer: 'pilot', preview: '1', page: '2'};
  const page = await loadPage(modelRoute);
  const props = {params: Promise.resolve(params), searchParams: Promise.resolve(selection)};
  const applied = await page.default(props);
  assert.deepEqual(applied, {...selection, market: 'china', make: 'BMW', model: '3 SERIES'});
  assert.equal(matchesCatalogModel('3 Series', applied.model, applied.make), true);
  assert.equal(matchesCatalogModel('5 Series', applied.model, applied.make), false);
  assert.equal(catalogSearchHeading(applied), 'BMW 3 SERIES из Китая');
  // The server selection must match the browser draft, so it can acknowledge it.
  const draft = {...selection, market: 'china', make: 'BMW', model: '3 SERIES'};
  assert.equal(new URLSearchParams(applied).toString(), new URLSearchParams(draft).toString());
  const href = canonicalCatalogHref('/cars?' + new URLSearchParams(applied));
  assert.equal(href, pathname + '?' + new URLSearchParams(selection));
  assert.equal(canonicalCatalogHref(href), href);
  const metadata = await page.generateMetadata(props);
  assert.equal(metadata.alternates.canonical, pathname + '?page=2');
  assert.match(metadata.title, /^BMW 3 SERIES из Китая/);
  assert.doesNotMatch(metadata.title, /%20|%2520/);
});

test('make and model pages decode spaces and Unicode once while preserving literal plus and percent', async () => {
  const pages = await Promise.all([loadPage(makeRoute), loadPage(modelRoute)]);
  for (const make of ['Land Rover', 'Лада', '100% Motors']) {
    const pathname = '/cars/china/' + encodeURIComponent(make);
    const props = {params: Promise.resolve(pageParams(pathname, makeRoute)), searchParams: Promise.resolve({model: 'Unencoded query %20 +', city: 'Москва'})};
    const applied = await pages[0].default(props);
    assert.equal(applied.make, make);
    assert.equal(applied.model, 'Unencoded query %20 +', 'query values are not path-decoded');
    const metadata = await pages[0].generateMetadata({...props, searchParams: Promise.resolve({})});
    assert.equal(metadata.alternates.canonical, pathname);
  }
  for (const model of ['Range Rover Sport', '3 SERIES (G20)', 'Модель 3', 'C++', '100% Electric', 'Literal%20name', 'Literal%2Fname']) {
    const pathname = '/cars/china/BMW/' + encodeURIComponent(model);
    const props = {params: Promise.resolve(pageParams(pathname)), searchParams: Promise.resolve({city: 'Москва'})};
    const applied = await pages[1].default(props);
    assert.equal(applied.model, model);
    assert.equal((await pages[1].generateMetadata(props)).alternates.canonical, pathname);
    assert.deepEqual(catalogRouteParams(pathname), {market: 'china', make: 'BMW', model});
  }
});

test('invalid encoded segments fail as a normal not-found route, without URI errors or unsafe search values', async () => {
  const page = await loadPage(modelRoute);
  for (const model of ['%E0%A4%A', '%2Fprivate', '%5Cprivate', '%00', '%1F']) {
    assert.equal(decodeCatalogPathParams({market: 'china', make: 'BMW', model}), null);
    assert.equal(catalogRouteParams('/cars/china/BMW/' + model), null);
    const props = {params: Promise.resolve({market: 'china', make: 'BMW', model}), searchParams: Promise.resolve({})};
    await assert.rejects(page.default(props), /NEXT_HTTP_ERROR_FALLBACK;404/);
    await assert.rejects(page.generateMetadata(props), /NEXT_HTTP_ERROR_FALLBACK;404/);
  }
  assert.equal(decodeCatalogPathParams({market: 'unknown', make: 'BMW'}), null);
});
