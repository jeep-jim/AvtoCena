import assert from 'node:assert/strict';
import test from 'node:test';
import {readOwnedJsonBounded, assertOwnedSignedReadUrl, OWNED_RAW_READ_TARGET} from '../apps/web/lib/catalog/owned-bounded-json.mjs';

const key = 'catalog/raw-feed-coordination/v1/contributions/gen_2000_test/encar_direct/internal.json';
const signedUrl = targetKey => {
  const url = new URL(OWNED_RAW_READ_TARGET.origin + '/' + OWNED_RAW_READ_TARGET.bucket + '/' + OWNED_RAW_READ_TARGET.prefix + targetKey);
  for (const [name, value] of Object.entries({'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': 'fixture-secret/20261116/ru-central1/s3/aws4_request', 'X-Amz-Date': '20261116T120000Z',
    'X-Amz-Expires': '120', 'X-Amz-SignedHeaders': 'host', 'X-Amz-Signature': 'a'.repeat(64)})) url.searchParams.set(name, value);
  return url.toString();
};
const storage = {driver: 'object', async createBinaryDownloadUrl(requested) {return signedUrl(requested);}};

test('bounded owned GET uses only the exact signed target, identity encoding and no redirects', async () => {
  let calls = 0;
  const result = await readOwnedJsonBounded({storage, key, maxBytes: 100, fetcher: async (url, options) => {
    calls++; assert.equal(url, signedUrl(key)); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['accept-encoding'], 'identity'); assert.equal(options.method, 'GET');
    return new Response('{"value":1}', {headers: {'content-length': '11'}});
  }});
  assert.deepEqual(result, {found: true, value: {value: 1}, bytes: 11}); assert.equal(calls, 1);
});

test('wrong origin, bucket, prefix, exact key or duplicate signing parameter fails before fetch without leaking the signed URL', async () => {
  for (const change of [url => {url.hostname = 'example.com';}, url => {url.pathname = url.pathname.replace('avtocena-staging-8120751', 'other');},
    url => {url.pathname = url.pathname.replace('full-20261011', 'other');}, url => {url.pathname = url.pathname.replace('internal.json', 'manifest.json');},
    url => {url.searchParams.append('X-Amz-Expires', '120');}]) {
    let fetched = false;
    const bad = {driver: 'object', async createBinaryDownloadUrl() {const url = new URL(signedUrl(key)); change(url); return url.toString();}};
    await assert.rejects(readOwnedJsonBounded({storage: bad, key, maxBytes: 100,
      fetcher: async () => {fetched = true; throw Error('must_not_fetch');}}), error => {
      assert.match(error.message, /owned_json_/); assert.doesNotMatch(error.message, /fixture-secret|X-Amz|https:/); return true;
    });
    assert.equal(fetched, false);
  }
  assert.throws(() => assertOwnedSignedReadUrl(signedUrl('catalog/japan/raw.json'), 'catalog/japan/raw.json'), /key_scope/);
});

test('declared and streamed oversized bodies are cancelled and abort their request', async () => {
  for (const declared of [false, true]) {
    let cancelled = false, signal;
    const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(101));}, cancel() {cancelled = true;}});
    await assert.rejects(readOwnedJsonBounded({storage, key, maxBytes: 100, fetcher: async (_url, options) => {
      signal = options.signal; return new Response(body, {headers: declared ? {'content-length': '101'} : {}});
    }}), /owned_json_bytes/);
    assert.equal(cancelled, true); assert.equal(signal.aborted, true);
  }
});

test('HTTP compression is rejected before consumption so encoded and decoded bounds cannot diverge', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(1));}, cancel() {cancelled = true;}});
  await assert.rejects(readOwnedJsonBounded({storage, key, maxBytes: 100,
    fetcher: async () => new Response(body, {headers: {'content-encoding': 'gzip'}})}), /owned_json_encoding/);
  assert.equal(cancelled, true);
});

test('only an actual 404 is absence; forbidden, redirect, malformed JSON and truncated identity bodies are failures', async () => {
  assert.deepEqual(await readOwnedJsonBounded({storage, key, maxBytes: 100,
    fetcher: async () => new Response(null, {status: 404})}), {found: false, value: null, bytes: 0});
  for (const [response, code] of [[new Response('denied', {status: 403}), /http_403/],
    [new Response(null, {status: 302}), /http_302/], [new Response('not JSON'), /malformed/],
    [new Response('{}', {headers: {'content-length': '4'}}), /length/]] as const) {
    await assert.rejects(readOwnedJsonBounded({storage, key, maxBytes: 100, fetcher: async () => response}), code);
  }
});

test('a deadline aborts an unfinished body and does not expose transport errors or credentials', async () => {
  let cancelled = false, signal;
  const body = new ReadableStream({pull() {return new Promise(() => {});}, cancel() {cancelled = true;}});
  await assert.rejects(readOwnedJsonBounded({storage, key, maxBytes: 100, deadline: Date.now() + 30,
    fetcher: async (_url, options) => {signal = options.signal; return new Response(body);}}), /deadline/);
  assert.equal(cancelled, true); assert.equal(signal.aborted, true);
  await assert.rejects(readOwnedJsonBounded({storage, key, maxBytes: 100,
    fetcher: async () => {throw Error(signedUrl(key));}}), error => {
    assert.equal(error.message, 'owned_json_transport'); return true;
  });
});

test('a body whose cancel hook never settles cannot extend the request deadline', async () => {
  let aborted = false;
  const body = new ReadableStream({pull() {return new Promise(() => {});}, cancel() {return new Promise(() => {});}});
  let watchdog;
  try {
    const call = readOwnedJsonBounded({storage, key, maxBytes: 100, deadline: Date.now() + 30,
      fetcher: async (_url, options) => {options.signal.addEventListener('abort', () => {aborted = true;}); return new Response(body);}});
    await assert.rejects(Promise.race([call, new Promise((_, reject) => {watchdog = setTimeout(() => reject(Error('cancel_hung')), 300);})]), /owned_json_deadline/);
    assert.equal(aborted, true);
  } finally {clearTimeout(watchdog);}
});
