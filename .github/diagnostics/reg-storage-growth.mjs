import assert from 'node:assert/strict';
import { ObjectJsonStorage } from '../../apps/web/lib/data.ts';

// Read-only metadata inventory: never GET object contents or issue writes.
let stage = 'configuration';
try {
  const endpoint = process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
  const origin = new URL(endpoint);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.hostname, 's3.regru.cloud');
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
  const groups=new Map();
  const now=Date.now();
  for(const item of objects){
    const key=prefix&&item.key.startsWith(`${prefix}/`)?item.key.slice(prefix.length+1):item.key;
    let group='other';
    if(/astra/i.test(key))group='ASTRA';
    else if(/encyclopedia|vehicle-knowledge|vehicle-model/i.test(key))group='encyclopedia';
    else if(key.startsWith('catalog/generations/'))group='catalog-generations';
    else if(key.startsWith('catalog/internal/'))group='catalog-internal';
    else if(key.startsWith('catalog/images/'))group='catalog-images';
    else if(key.startsWith('catalog/runtime-budget-prices-'))group='budget-price-snapshots';
    else if(key.startsWith('catalog/runtime-sort-prices-'))group='sort-price-snapshots';
    else if(key.startsWith('catalog/runtime/'))group='catalog-runtime';
    else if(key.startsWith('catalog/public/'))group='catalog-public-projections';
    else if(key.startsWith('catalog/'))group='catalog-other';
    else if(key.startsWith('crm/')||key.startsWith('leads/')||key.startsWith('clients/'))group='CRM';
    if(prefix&&!item.key.startsWith(`${prefix}/`))group='outside-app-prefix';
    const g=groups.get(group)||{group,objects:0,bytes:0,modifiedLast24hBytes:0,modifiedLast48hBytes:0};
    g.objects++;g.bytes+=item.size;
    const age=now-Date.parse(item.lastModified||'');
    if(age>=0&&age<=86400000)g.modifiedLast24hBytes+=item.size;
    if(age>=0&&age<=172800000)g.modifiedLast48hBytes+=item.size;
    groups.set(group,g);
  }
  console.log(JSON.stringify({source:'REG S3',checkedAt:new Date().toISOString(),completedPages,requests,totalObjects:objects.length,totalBytes:allBytes,decimalGB:allBytes/1e9,binaryGiB:allBytes/2**30,groups:[...groups.values()].sort((a,b)=>b.bytes-a.bytes),scope:'Current object versions only; modified bytes are not net growth; active writers can change totals. Metadata only, no object contents or mutations.'}));

} catch (error) {
  const status = String(error?.message || '').match(/object_storage_[A-Za-z]+_(\d{3})/)?.[1];
  console.error(`Inventory failed at ${stage}: ${error?.name || 'Error'}${status ? ` HTTP ${status}` : ''}`);
  process.exitCode = 1;
}
