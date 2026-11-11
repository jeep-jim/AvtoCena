import assert from 'node:assert/strict';
import { ObjectJsonStorage } from '../apps/web/lib/data.ts';

// Read-only metadata inventory: never GET object contents or issue writes.
let stage = 'configuration';
try {
  const endpoint = process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
  const origin = new URL(endpoint);
  assert.equal(origin.protocol, 'https:');
  assert.ok(/(^|\.)yandexcloud\.net$/.test(origin.hostname));
  assert.ok(!origin.username && !origin.password);
  for (const key of ['YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']) assert.ok(process.env[key]?.trim());
  process.env.YC_OBJECT_STORAGE_ENDPOINT = endpoint;
  process.env.YC_OBJECT_STORAGE_REGION ||= 'ru-central1';
  const originalFetch = globalThis.fetch;
  let requests = 0;
  let completedPages = 0;
  let finalPage = false;
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    assert.equal(url.origin, origin.origin);
    assert.equal(options?.method, 'GET');
    assert.equal(url.searchParams.get('list-type'), '2');
    assert.equal(url.pathname, `/${process.env.YC_OBJECT_STORAGE_BUCKET}`);
    assert.ok(++requests <= 3000, 'Bounded inventory exceeded');
    const response = await originalFetch(input, options);
    if (response.ok) {
      const xml = await response.clone().text();
      assert.match(xml, /<ListBucketResult[\s>]/);
      assert.match(xml, /<IsTruncated>(true|false)<\/IsTruncated>/);
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      if (truncated) assert.match(xml, /<NextContinuationToken>[^<]+<\/NextContinuationToken>/);
      completedPages++;
      if (!truncated) finalPage = true;
    }
    return response;
  };
  stage = 'list source metadata';
  const objects = await new ObjectJsonStorage().listBucketObjects('');
  assert.ok(finalPage && completedPages > 0, 'Incomplete listing');
  const prefix = (process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
  let allBytes = 0, appBytes = 0, appObjects = 0, largestBytes = 0;
  const seen = new Set();
  for (const item of objects) {
    assert.ok(!seen.has(item.key), 'Duplicate object in inventory'); seen.add(item.key);
    assert.ok(Number.isSafeInteger(item.size) && item.size >= 0);
    allBytes += item.size; largestBytes = Math.max(largestBytes, item.size);
    if (!prefix || item.key.startsWith(`${prefix}/`)) { appBytes += item.size; appObjects++; }
  }
  console.log(JSON.stringify({ source: 'Yandex S3', completedPages, requests, totalObjects: objects.length, totalBytes: allBytes,
    configuredPrefixObjects: appObjects, configuredPrefixBytes: appBytes,
    outsideConfiguredPrefixObjects: objects.length - appObjects, largestObjectBytes: largestBytes,
    decimalGB: allBytes / 1e9, binaryGiB: allBytes / 2 ** 30,
    scope: 'Current object versions only; historical versions and multipart uploads not included',
    note: 'Metadata only. No contents downloaded, no data copied or deleted. Active writers may change these totals.' }, null, 2));
} catch (error) {
  const status = String(error?.message || '').match(/object_storage_[A-Za-z]+_(\d{3})/)?.[1];
  console.error(`Inventory failed at ${stage}: ${error?.name || 'Error'}${status ? ` HTTP ${status}` : ''}`);
  process.exitCode = 1;
}
