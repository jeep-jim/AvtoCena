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
  for (const src of ['/api/catalog/photo/signed?url=source&market=china', 'https://7.tru.ru/img/same_lot&w=320'])
  for (const mode of ['loaded', 'replaced', 'disconnected', 'unmounted']) {
    const img = image(src); retryProtectedPhotoImage(img.element);
    if (mode === 'loaded') Object.assign(img.element, {naturalWidth: 1024});
    if (mode === 'replaced') img.element.src = '/api/catalog/photo/another';
    if (mode === 'disconnected') Object.assign(img.element, {isConnected: false});
    if (mode === 'unmounted') cancelProtectedPhotoRetry(img.element);
    const before = img.writes(); t.mock.timers.tick(18_000);
    assert.equal(img.writes(), before, mode);
  }
  assert.equal(retryProtectedPhotoImage(image('https://source.example/image.jpg').element), false);
});

test('allowlisted AJ images keep the exact rendition, duplicate-error guard, jitter and two-retry bound', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  t.mock.method(Math, 'random', () => 0.5);
  const urls = [
    'https://7.tru.ru/img/lot_A-1&w=320',
    'https://7.ajes.com/imgs/lot_B-2&h=50',
    'https://8.ajes.com/img/lot_C-3',
    'https://9.ajes.com/imgs/lot_D-4&h=300&w=400',
  ];
  const images = urls.map(url => image(url));
  for (const img of images) {
    assert.equal(retryProtectedPhotoImage(img.element), true);
    assert.equal(retryProtectedPhotoImage(img.element), true, 'duplicate error queues no second timer');
  }
  t.mock.timers.tick(16_499);
  for (const img of images) assert.equal(img.writes(), 0);
  t.mock.timers.tick(1);
  for (const img of images) {
    assert.equal(img.writes(), 1);
    assert.equal(retryProtectedPhotoImage(img.element), true);
  }
  t.mock.timers.tick(36_499);
  for (const img of images) assert.equal(img.writes(), 1);
  t.mock.timers.tick(1);
  images.forEach((img, index) => {
    assert.equal(img.writes(), 2);
    assert.equal(retryProtectedPhotoImage(img.element), false);
    assert.equal(img.element.src, urls[index], 'no rendition conversion, query, or cache-buster');
  });
  t.mock.timers.tick(120_000);
  for (const img of images) assert.equal(img.writes(), 2);
});

test('direct retries reject other hosts, protocols, paths, credentials, query strings and fragments', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const rejected = [
    'http://7.tru.ru/img/lot_A', '//7.tru.ru/img/lot_A',
    'https://7.tru.ru.example/img/lot_A', 'https://www.7.tru.ru/img/lot_A',
    'https://10.ajes.com/img/lot_A', 'https://img.akebono.world/lot_A.jpg',
    'https://user:password@7.tru.ru/img/lot_A', 'https://7.tru.ru:8443/img/lot_A',
    'https://7.tru.ru/api/list', 'https://7.tru.ru/img/lot_A.jpg',
    'https://7.tru.ru/img/lot_A?w=320', 'https://7.tru.ru/img/lot_A#photo',
    'https://7.tru.ru/img/lot_A&resize=320', 'https://7.tru.ru/img/lot_A/other',
    'data:image/png;base64,AA==', '',
  ].map(src => image(src));
  for (const img of rejected) assert.equal(retryProtectedPhotoImage(img.element), false);
  t.mock.timers.tick(120_000);
  for (const img of rejected) assert.equal(img.writes(), 0);
});

test('a different allowed AJ source gets its own bounded budget without an old pending write', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  t.mock.method(Math, 'random', () => 0);
  const img = image('https://7.tru.ru/img/first&w=320');
  assert.equal(retryProtectedPhotoImage(img.element), true);
  img.element.src = 'https://8.ajes.com/img/second&h=50';
  const afterChange = img.writes();
  t.mock.timers.tick(15_000);
  assert.equal(img.writes(), afterChange, 'old timer checks the exact current source');
  assert.equal(retryProtectedPhotoImage(img.element), true);
  t.mock.timers.tick(15_000);
  assert.equal(retryProtectedPhotoImage(img.element), true);
  t.mock.timers.tick(35_000);
  assert.equal(img.writes(), afterChange + 2);
  assert.equal(retryProtectedPhotoImage(img.element), false);
  assert.equal(img.element.src, 'https://8.ajes.com/img/second&h=50');
});
