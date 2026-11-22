import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assertServingReadModelContext, readServingProjectionRows} from './lib/catalog-serving-read-models.mjs';
import {assertStagedRuntimeSource} from './lib/catalog-staged-budget.mjs';

export function installServingReadModelNetworkFence() {
  const deny = () => { throw Error('serving_read_model_network_forbidden'); };
  globalThis.fetch = async () => deny();
  for (const module of [http, https]) for (const name of ['request', 'get']) module[name] = deny;
  syncBuiltinESMExports();
}

export async function buildServingReadModel({catalog, request, now = () => new Date()}) {
  if (!['budget', 'landing', 'overview'].includes(request?.task)
      || !Number.isSafeInteger(request.rows) || request.rows < 0) throw Error('serving_read_model_request_invalid');
  const started = now(), day = value => new Date(value.getTime() + 7 * 3600000).toISOString().slice(0,10);
  let count = 0;
  if (request.task === 'budget') {
    const handle = await fs.open(request.output, 'wx', 0o600);
    let batch = [], writtenBytes = 0;
    const flush = async () => {
      const prepared = await catalog.prepareCatalogProjectionRows(batch);
      const ids = new Map(batch.map(row => [row.id, row.market])), seen = new Set();
      if (!Array.isArray(prepared) || prepared.some(row => !ids.has(row?.id)
          || ids.get(row.id) !== row.market || seen.has(row.id) || !seen.add(row.id))) {
        throw Error('serving_read_model_budget_identity_invalid');
      }
      let buffer = '', bytes = 0;
      for (const row of prepared) {
        const line = JSON.stringify(row) + '\n', length = Buffer.byteLength(line);
        if (length > 4 * 1024 ** 2) throw Error('serving_read_model_line_bound');
        writtenBytes += length;
        if (writtenBytes > 2 * 1024 ** 3) throw Error('serving_read_model_byte_bound');
        if (bytes + length > 4 * 1024 ** 2) { await handle.write(buffer); buffer = ''; bytes = 0; }
        buffer += line; bytes += length;
      }
      if (buffer) await handle.write(buffer);
      batch = [];
    };
    try {
      for await (const row of readServingProjectionRows(request.input)) {
        count++; batch.push(row);
        if (batch.length === 500) await flush();
      }
      if (batch.length) await flush();
    } finally { await handle.close(); }
    if (day(started) !== day(now())) throw Error('serving_read_model_policy_day_changed');
  } else {
    if (!/^gen_\d+_[a-z0-9]+$/.test(request.generationId || '') || !/^\d{4}-\d{2}-\d{2}T/.test(request.now || '')) {
      throw Error('serving_read_model_request_invalid');
    }
    const rows = [];
    for await (const row of readServingProjectionRows(request.input)) { count++; rows.push(row); }
    const date = new Date(request.now);
    if (!Number.isFinite(date.getTime())) throw Error('serving_read_model_request_invalid');
    const result = request.task === 'landing'
      ? await catalog.buildCatalogMarketLanding(request.generationId, request.market, rows, {now:date})
      : await catalog.buildCatalogOverviewFromProjections(request.generationId, rows, {now:date});
    if (result?.generationId !== request.generationId || result.policyDate !== day(date)
        || request.task === 'landing' && (result.market !== request.market || result.sourceTotal !== rows.length)) {
      throw Error('serving_read_model_result_invalid');
    }
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > 32 * 1024 ** 2) throw Error('serving_read_model_result_bound');
    await fs.writeFile(request.output, body, {flag:'wx', mode:0o600});
  }
  if (count !== request.rows) throw Error('serving_read_model_input_incomplete');
  return {task:request.task, inputRows:count};
}

async function main() {
  const [root, contextPath, requestPath] = process.argv.slice(2);
  if (!root || process.cwd() !== path.resolve(root)) throw Error('serving_read_model_root_invalid');
  const context = JSON.parse(await fs.readFile(contextPath, 'utf8'));
  assertServingReadModelContext(context);
  assertStagedRuntimeSource(root, context.release);
  if (process.env.AVTOCENA_RELEASE_SHA !== context.release || process.env.AVTOCENA_CALCULATION_VERSION !== context.calculationVersion) {
    throw Error('serving_read_model_runtime_context_changed');
  }
  installServingReadModelNetworkFence();
  const runtime = relative => import(pathToFileURL(path.join(root, relative)).href);
  const {getJsonStorage} = await runtime('apps/web/lib/data.ts');
  const storage = getJsonStorage();
  for (const name of ['readJson','readJsonWithMeta','readObjectMetadata','writeJson','deleteJson','exists',
    'putBinary','getBinary','createBinaryDownloadUrl','binaryExists','deleteBinary','listObjects',
    'listBucketObjects','listObjectVersions','listMultipartUploads','deleteObjects','deletePrefix']) {
    storage[name] = async () => { throw Error('serving_read_model_storage_forbidden'); };
  }
  const encyclopedia = await runtime('apps/web/lib/encyclopedia/calculation-index.ts');
  if ((encyclopedia.readCalculationIndex()?.digest || null) !== context.encyclopediaDigest) throw Error('serving_read_model_encyclopedia_changed');
  const catalog = await runtime('apps/web/lib/catalog/storage.ts');
  const report = await buildServingReadModel({catalog, request:JSON.parse(await fs.readFile(requestPath, 'utf8'))});
  console.log(JSON.stringify({stage:'serving_read_model_prepared', ...report, release:context.release}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const code = String(error?.message || '');
    console.error(/^[a-z][a-z0-9_:.-]{1,200}$/.test(code) ? code : 'serving_read_model_failed');
    process.exitCode = 1;
  });
}
