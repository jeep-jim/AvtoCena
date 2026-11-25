import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelProtectedPhotoRetry, listenForVisiblePhotoRecovery, retryProtectedPhotoImage} from '../apps/web/components/catalog/protected-photo-retry';

function image(src = '/api/catalog/photo/signed?url=source&market=china') {
  let writes = 0;
  const element = {isConnected: true, complete: true, naturalWidth: 0, dataset: {},
    getAttribute: () => src,
    get src() { return src; }, set src(value: string) { src = value; writes++; }};
  return {element: element as unknown as HTMLImageElement, writes: () => writes};
}

test('failed image discovered after hydration recovers with bounded spaced retries', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const img = image();
  assert.equal(retryProtectedPhotoImage(img.element), true);
  assert.equal(retryProtectedPhotoImage(img.element), true); // duplicate error does not queue twice
  t.mock.timers.tick(14_999); assert.equal(img.writes(), 0);
  t.mock.timers.tick(3_001); assert.equal(img.writes(), 1);
  assert.equal(retryProtectedPhotoImage(img.element), true);
  t.mock.timers.tick(34_999); assert.equal(img.writes(), 1);
  t.mock.timers.tick(3_001); assert.equal(img.writes(), 2);
  assert.equal(retryProtectedPhotoImage(img.element), false);
  assert.equal(img.element.src, '/api/catalog/photo/signed?url=source&market=china');
});

test('loaded, replaced, disconnected and unmounted images do not trigger stale retries', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const mode of ['loaded', 'replaced', 'disconnected', 'unmounted']) {
    const img = image(); retryProtectedPhotoImage(img.element);
    if (mode === 'loaded') Object.assign(img.element, {naturalWidth: 1024});
    if (mode === 'replaced') img.element.src = '/api/catalog/photo/another';
    if (mode === 'disconnected') Object.assign(img.element, {isConnected: false});
    if (mode === 'unmounted') cancelProtectedPhotoRetry(img.element);
    const before = img.writes(); t.mock.timers.tick(18_000);
    assert.equal(img.writes(), before, mode);
  }
  assert.equal(retryProtectedPhotoImage(image('https://source.example/image.jpg').element), false);
});

function visiblePlaceholder() {
  const window = Object.assign(new EventTarget(), {innerWidth: 390, innerHeight: 844, navigator: {onLine: true}});
  const document = Object.assign(new EventTarget(), {defaultView: window, visibilityState: 'visible'});
  const rect = {top: 20, bottom: 220, left: 10, right: 300, width: 290, height: 200};
  const element = {ownerDocument: document, isConnected: true, getBoundingClientRect: () => rect};
  return {window, document, rect, element: element as unknown as HTMLElement};
}

test('return recovery observes cooldown, visible card and online state, then fires once', t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1_000});
  const view = visiblePlaceholder(); let calls = 0;
  const stop = listenForVisiblePhotoRecovery(view.element, () => calls++);
  view.window.dispatchEvent(new Event('online')); assert.equal(calls, 0);
  view.document.visibilityState = 'hidden';
  t.mock.timers.tick(15_000);
  view.window.dispatchEvent(new Event('online')); assert.equal(calls, 0);
  view.document.visibilityState = 'visible'; view.window.navigator.onLine = false;
  view.document.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 0);
  view.window.navigator.onLine = true; view.rect.top = 900;
  view.window.dispatchEvent(new Event('online')); assert.equal(calls, 0);
  view.rect.top = 20; view.rect.width = 0;
  view.window.dispatchEvent(new Event('online')); assert.equal(calls, 0);
  view.rect.width = 290;
  view.document.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 1);
  view.window.dispatchEvent(new Event('online'));
  view.document.dispatchEvent(new Event('visibilitychange')); assert.equal(calls, 1);
  stop();
});

test('a visible online placeholder gets one delayed recovery without a return event', t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1_000});
  const view = visiblePlaceholder(); let calls = 0;
  const stop = listenForVisiblePhotoRecovery(view.element, () => calls++);
  t.mock.timers.tick(14_999); assert.equal(calls, 0);
  t.mock.timers.tick(1); assert.equal(calls, 1);
  t.mock.timers.tick(120_000);
  view.window.dispatchEvent(new Event('online'));
  view.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  stop();
});

test('cancelled or detached placeholder never starts a recovery cycle', t => {
  t.mock.timers.enable({apis: ['Date', 'setTimeout'], now: 1_000});
  for (const mode of ['cancelled', 'detached']) {
    const view = visiblePlaceholder(); let calls = 0;
    const stop = listenForVisiblePhotoRecovery(view.element, () => calls++);
    if (mode === 'cancelled') stop();
    else Object.assign(view.element, {isConnected: false});
    t.mock.timers.tick(15_000);
    view.window.dispatchEvent(new Event('online'));
    view.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(calls, 0, mode); stop();
  }
});
