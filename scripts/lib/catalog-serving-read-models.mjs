import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {restoreReleaseEncyclopedia} from '../encyclopedia/restore-calculation-index.mjs';
import {assertStagedRuntimeSource, assertStagedCalculatorBuild, readLiveBudgetIdentity} from './catalog-staged-budget.mjs';

const run = promisify(execFile);
const child = fileURLToPath(new URL('../catalog-serving-read-model-child.mjs', import.meta.url));
const MAX_ROWS = 1_000_000, MAX_BYTES = 2 * 1024 ** 3, MAX_LINE = 4 * 1024 ** 2;

export async function writeServingProjectionRows(file, rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw Error('serving_read_model_row_bound');
  const handle = await fs.open(file, 'wx', 0o600);
  let bytes = 0, buffer = [], bufferedBytes = 0;
  try {
    for (const row of rows) {
      const line = JSON.stringify(row), length = line ? Buffer.byteLength(line) + 1 : 0;
      if (!line || length > MAX_LINE) throw Error('serving_read_model_line_bound');
      if (bufferedBytes + length > MAX_LINE && buffer.length) {
        await handle.write(buffer.join('')); buffer = []; bufferedBytes = 0;
      }
      buffer.push(line + '\n'); bufferedBytes += length; bytes += length;
      if (bytes > MAX_BYTES) throw Error('serving_read_model_byte_bound');
    }
    if (buffer.length) await handle.write(buffer.join(''));
  } finally { await handle.close(); }
}

export async function* readServingProjectionRows(file) {
  if ((await fs.stat(file)).size > MAX_BYTES) throw Error('serving_read_model_byte_bound');
  const stream = createReadStream(file), lines = createInterface({input:stream, crlfDelay:Infinity});
  let count = 0;
  try {
    for await (const line of lines) {
      if (!line || Buffer.byteLength(line) > MAX_LINE || ++count > MAX_ROWS) throw Error('serving_read_model_row_bound');
      yield JSON.parse(line);
    }
  } finally { lines.close(); stream.destroy(); }
}

export function assertServingReadModelContext(context) {
  if (context?.version !== 1 || !/^[a-f0-9]{40}$/.test(context.release || '')
      || !/^[a-f0-9]{64}$/.test(context.calculationVersion || '')
      || context.encyclopediaDigest !== null && !/^[a-f0-9]{64}$/.test(context.encyclopediaDigest || '')) {
    throw Error('serving_read_model_context_invalid');
  }
}

/** Offline builders run in the exact serving checkout. Importing its module in
 * the publisher process would still resolve getDataRoot() against publisher cwd.
 * JSONL transfers are bounded; only one child runs, even for parallel markets.
 * Vehicle rows, source admission, public manifest and staged coverage are unchanged. */
export async function createServingPublicationReadModelBuilders({storage,
  runtimeRoot = process.env.CATALOG_BUDGET_RUNTIME_ROOT, release = process.env.CATALOG_BUDGET_RUNTIME_RELEASE}) {
  if (storage.driver !== 'object' || !runtimeRoot) throw Error('staged_budget_runtime_required');
  const root = path.resolve(runtimeRoot);
  assertStagedRuntimeSource(root, release);
  const identity = await readLiveBudgetIdentity();
  if (identity.release !== release) throw Error('staged_budget_live_calculator_changed');
  const encyclopediaDigest = await restoreReleaseEncyclopedia(storage, root, release);
  const {calculationVersion} = await import(pathToFileURL(path.join(root, 'scripts/catalog-calculation-version.mjs')).href);
  assertStagedCalculatorBuild(release, calculationVersion(root), identity.calculationVersion);
  const context = {version:1, ...identity, encyclopediaDigest};
  assertServingReadModelContext(context);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-serving-read-models-'));
  const contextPath = path.join(directory, 'context.json');
  await fs.writeFile(contextPath, JSON.stringify(context), {mode:0o600});
  const inputs = new WeakMap();
  let sequence = 0, queue = Promise.resolve(), closed = false;
  function invoke(task, rows, details = {}) {
    if (closed) return Promise.reject(Error('serving_read_model_builder_closed'));
    const pending = queue.then(async () => {
      let input = inputs.get(rows);
      if (!input) {
        input = path.join(directory, 'input-' + ++sequence + '.jsonl');
        await writeServingProjectionRows(input, rows);
        inputs.set(rows, input);
      }
      const output = path.join(directory, 'output-' + ++sequence + (task === 'budget' ? '.jsonl' : '.json'));
      const requestPath = path.join(directory, 'request-' + sequence + '.json');
      await fs.writeFile(requestPath, JSON.stringify({task, input, output, rows:rows.length, ...details}), {mode:0o600});
      await run(process.execPath, ['--import', 'tsx', child, root, contextPath, requestPath], {
        cwd:root, env:{...process.env, AVTOCENA_RELEASE_SHA:release,
          AVTOCENA_CALCULATION_VERSION:identity.calculationVersion, NODE_OPTIONS:'--max-old-space-size=3072'},
        timeout:10 * 60_000, maxBuffer:64 * 1024,
      });
      let result;
      if (task === 'budget') {
        result = [];
        for await (const row of readServingProjectionRows(output)) result.push(row);
      } else {
        if ((await fs.stat(output)).size > 32 * 1024 ** 2) throw Error('serving_read_model_result_bound');
        result = JSON.parse(await fs.readFile(output, 'utf8'));
      }
      await fs.rm(output);
      return result;
    });
    // A failed builder stops all queued tasks; it is never replaced with current-main policy.
    queue = pending;
    return pending;
  }
  return {
    context,
    prepareBudgetRows: rows => invoke('budget', rows),
    buildLanding: (generationId, market, rows, options = {}) => invoke('landing', rows,
      {generationId, market, now:(options.now || new Date()).toISOString()}),
    buildOverview: (generationId, rows, options = {}) => invoke('overview', rows,
      {generationId, now:(options.now || new Date()).toISOString()}),
    async dispose() {
      closed = true;
      await queue.catch(() => {});
      await fs.rm(directory, {recursive:true, force:true});
    },
  };
}
