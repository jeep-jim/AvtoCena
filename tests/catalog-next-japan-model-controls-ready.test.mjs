import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {selectJapanStabilityModelThroughUi, waitForJapanStabilityControls}
  from '../scripts/catalog-next/japan-stability-browser.mjs';

const CITY = 'Новокузнецк';
const MODEL = 'MAZDA3 FASTBACK';
const directory = [{model: MODEL, total: 24}, {model: 'AXELA', total: 12}];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };

/** Deliberately separate document appearance, hydration and route acknowledgement.
 * A visible SSR trigger is clickable before its event handler can work. */
function journey({remount = false, ready = {}, failAt, sourceMake = 'MAZDA',
  options = [{make: 'MAZDA', model: MODEL}, {make: 'MAZDA', model: 'AXELA'}],
  wrongModelUrl = false, wrongSelectedValue = false, duplicateExact = false,
  popupState = undefined} = {}) {
  const progress = {}, events = [];
  let url = 'https://avtocena.com/cars/japan?' + new URLSearchParams({city: CITY});
  let brandExpanded = false, modelExpanded = false, selectedValue = '', modelUrl = false;
  const enter = async value => {
    events.push(value);
    if (value === failAt) { const error = Error('fixture timeout'); error.name = 'TimeoutError'; throw error; }
  };
  const node = value => ({getAttribute: key => key === 'data-model-value' ? value.model : value.make});
  const locator = selector => {
    if (selector === 'form.ac-catalog-filter-panel:visible'
      || selector === 'form.ac-catalog-filter-panel:visible[aria-busy="false"]') return {
      locator, getByRole,
      async waitFor(config) {
        assert.deepEqual(config, {state: 'visible', timeout: 30_000});
        await enter((selector.includes('aria-busy') ? 'ack:' : 'form:') + progress.phase);
        if (selector.includes('aria-busy')) await ready[progress.phase]?.ack;
      },
    };
    if (selector === 'button[aria-label="Расширенные фильтры"]:enabled[aria-busy="false"]') return {
      async waitFor(config) {
        // This button is CSS-hidden in the actual sidebar. A visibility wait
        // would deadlock even after a completely healthy hydration.
        assert.deepEqual(config, {state: 'attached', timeout: 30_000});
        await enter('hydrate:' + progress.phase);
        ready[progress.phase]?.entered?.resolve();
        await ready[progress.phase]?.hydrated;
      },
    };
    if (selector.startsWith('button[aria-label="Выбрать марки автомобилей"]')) return {
      async click() { await enter(brandExpanded ? 'brand:close' : 'brand:open'); brandExpanded = !brandExpanded; },
      async getAttribute(key) { assert.equal(key, 'aria-expanded'); return String(brandExpanded); },
      async waitFor(config) {
        assert.deepEqual(config, {state: 'visible', timeout: 30_000});
        await enter(selector.includes('"true"') ? 'brand:expanded' : 'brand:closed');
        assert.equal(brandExpanded, selector.includes('"true"'));
      },
    };
    if (selector === 'button[data-facet-value="Mazda" i]:visible') return {
      async getAttribute(key) { assert.equal(key, 'data-facet-value'); await enter('brand:identity'); return sourceMake; },
      async click() {
        await enter('brand:select');
        url = 'https://avtocena.com/cars/japan/' + encodeURIComponent(sourceMake) + '?' + new URLSearchParams({city: CITY});
        if (remount) brandExpanded = false;
      },
    };
    if (selector.startsWith('input[aria-label="Модель автомобиля"]')) return {
      async click() { await enter('model:open'); modelExpanded = true; },
      async getAttribute(key) { assert.equal(key, 'aria-expanded'); return popupState ?? String(modelExpanded); },
      async inputValue() { return wrongSelectedValue ? 'OTHER' : selectedValue; },
      async waitFor(config) {
        assert.deepEqual(config, {state: 'visible', timeout: 30_000});
        await enter('model:closed'); assert.equal(modelExpanded, false);
      },
    };
    if (selector === 'input[type="hidden"][name="model"]') return {
      async inputValue() { return wrongSelectedValue ? 'OTHER' : selectedValue; },
    };
    if (selector === 'button[data-model-value]:visible') {
      const all = {
        first() { return {async waitFor(config) {
          assert.deepEqual(config, {state: 'visible', timeout: 60_000}); await enter('model:options');
        }}; },
        async evaluateAll(fn, arg) { return fn(options.map(node), arg); },
        filter({hasText}) { return {async evaluateAll(fn, arg) {
          const matches = options.filter(row => row.model.includes(hasText));
          return fn((duplicateExact ? [...matches, ...matches] : matches).map(node), arg);
        }}; },
        nth(index) { return {async click() {
          await enter('model:select'); selectedValue = options[index].model;
          url = 'https://avtocena.com/cars/japan/' + encodeURIComponent(sourceMake) + '/'
            + encodeURIComponent(wrongModelUrl ? 'OTHER' : selectedValue) + '?' + new URLSearchParams({city: CITY});
          modelUrl = true; if (remount) modelExpanded = false;
        }}; },
      };
      return all;
    }
    assert.fail('unexpected locator: ' + selector);
  };
  function getByRole(role, options) {
    assert.equal(role, 'button'); assert.deepEqual(options, {name: 'Закрыть список моделей', exact: true});
    return {async click() { await enter('model:close'); assert.equal(modelExpanded, true); modelExpanded = false; }};
  }
  const view = {locator, getByRole, url: () => url, async waitForURL(predicate, config) {
    assert.deepEqual(config, {timeout: 60_000});
    await enter(modelUrl ? 'model:url' : 'brand:url');
    assert(predicate(new URL(url)), 'exact canonical URL must match');
  }};
  return {view, progress, events, run: () => selectJapanStabilityModelThroughUi({view, directory, progress})};
}

test('visible SSR controls cannot receive the first brand click before hidden hydration marker is ready', async () => {
  const entered = deferred(), hydrated = deferred();
  const f = journey({ready: {initial_controls_ready: {entered, hydrated: hydrated.promise}}});
  const pending = f.run(); await entered.promise;
  assert.equal(f.progress.phase, 'initial_controls_ready');
  assert.equal(f.events.some(value => value.startsWith('brand:')), false);
  hydrated.resolve(); await pending;
  assert.equal(f.progress.readyChecks, 3);
  assert.equal(f.events.filter(value => value === 'brand:open').length, 1);
  assert(f.events.indexOf('brand:expanded') < f.events.indexOf('brand:identity'));
});

test('make navigation must acknowledge the new form before model interaction', async () => {
  const entered = deferred(), ack = deferred();
  const f = journey({ready: {after_brand_controls_ready: {entered, ack: ack.promise}}});
  const pending = f.run(); await entered.promise;
  assert.equal(f.progress.phase, 'after_brand_controls_ready');
  assert.equal(f.events.includes('model:open'), false);
  ack.resolve(); await pending;
  assert(f.events.indexOf('ack:after_brand_controls_ready') < f.events.indexOf('model:open'));
});

for (const remount of [false, true]) test(`model selection survives ${remount ? 'leaf remount' : 'preserved popup'} after exact route acknowledgement`, async () => {
  const entered = deferred(), ack = deferred();
  const f = journey({remount, ready: {after_model_controls_ready: {entered, ack: ack.promise}}});
  const pending = f.run(); await entered.promise;
  assert.equal(f.progress.phase, 'after_model_controls_ready');
  assert.equal(f.events.includes('model:close'), false);
  ack.resolve();
  assert.deepEqual(await pending, {sourceMake: 'MAZDA', selected: {make: 'MAZDA', model: MODEL}});
  assert.equal(f.events.filter(value => value === 'model:close').length, remount ? 0 : 1);
  assert.equal(f.progress.modelPopupClose, remount ? 'already_closed_after_navigation' : 'clicked_close');
  assert.equal(f.progress.modelPopupOpenAfterNavigation, !remount);
  assert.equal(f.progress.selectedValueMatched, true);
  assert.equal(f.progress.modelUrlMatched, true);
  assert.equal(f.progress.phase, 'selection_complete');
  assert.equal(JSON.stringify(f.progress).includes('https://'), false);
});

for (const [failure, phase] of [
  ['hydrate:initial_controls_ready', 'initial_controls_ready'],
  ['brand:expanded', 'brand_expanded'],
  ['brand:identity', 'brand_option'],
  ['ack:after_brand_controls_ready', 'after_brand_controls_ready'],
  ['model:options', 'model_options'],
  ['model:url', 'model_url'],
  ['model:close', 'model_close'],
]) test(`failure at ${failure} preserves the exact safe phase and never certifies selection`, async () => {
  const f = journey({failAt: failure});
  await assert.rejects(f.run(), error => error.name === 'TimeoutError');
  assert.equal(f.progress.phase, phase);
  assert.equal(f.progress.selectedValueMatched, undefined);
  if (phase === 'initial_controls_ready') assert.equal(f.events.some(value => value.startsWith('brand:')), false);
  if (phase === 'brand_expanded') assert.equal(f.events.includes('brand:identity'), false);
});

for (const [patch, expected] of [
  [{sourceMake: 'Toyota'}, /make_option_identity/],
  [{options: [{make: 'MAZDA', model: '3'}]}, /model_not_in_source/],
  [{duplicateExact: true}, /selected_option_identity/],
  [{wrongModelUrl: true}, /exact canonical URL/],
  [{wrongSelectedValue: true}, /model_selected_value/],
  [{popupState: 'unknown'}, /model_popup_state/],
]) test(`readiness never admits invalid selection: ${Object.keys(patch)[0]}`, async () => {
  const f = journey(patch); await assert.rejects(f.run(), expected);
  assert.equal(f.progress.selectedValueMatched, undefined);
});

test('progress phases accept no untrusted value or browser access', async () => {
  await assert.rejects(waitForJapanStabilityControls({locator() { assert.fail('must refuse first'); }}, {}, 'https://private.test'),
    /model_progress_phase/);
});

test('both workflows require the exact-runtime Chromium readiness fixture before deployment', async () => {
  for (const name of ['verify-china-photo-code.yml', 'catalog-next-china-photo-release.yml']) {
    const raw = await fs.readFile(new URL('../.github/workflows/' + name, import.meta.url), 'utf8');
    const steps = raw.split(/\n      - /);
    const index = steps.findIndex(step => step.startsWith('name: Verify hydrated Japan model controls'));
    assert(index > 0, name);
    const fixture = steps[index];
    assert.match(fixture, /if: steps\.photo_scope\.outputs\.scope == 'catalog-japan-stability-v1'/);
    assert.match(fixture, /PHOTO_RUNTIME_ROOT="\$RUNNER_TEMP\/china-serving-runtime-\$MODEL_SHA"/);
    assert.match(fixture, /JAPAN_MODEL_CONTROLS_READY_REPORT="\$RUNNER_TEMP\/japan-model-controls-ready-browser-report\.json" node tests\/browser\/japan-model-controls-ready\.mjs/);
    assert.doesNotMatch(fixture, /continue-on-error|\|\| true/);
    assert(steps.slice(0, index).some(step => step.includes('scripts/catalog-next/code-entry.mjs --verify')), name);
    assert(steps.slice(0, index).some(step => step.includes('playwright@1.55.0')), name);
    const after = name.startsWith('verify-') ? 'Test the native runtime' : 'Publish the code with existing China bytes';
    assert(steps.findIndex(step => step.startsWith('name: ' + after)) > index, name);
    assert(steps.slice(index + 1).some(step => step.includes('actions/upload-artifact@v4')
      && step.includes('japan-model-controls-ready-browser-report.json')), name);
  }
});
