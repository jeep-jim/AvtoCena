import test from 'node:test';
import assert from 'node:assert/strict';
import {cancelProtectedPhotoRetry, retryProtectedPhotoImage} from '../apps/web/components/catalog/protected-photo-retry';

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
