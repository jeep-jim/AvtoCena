import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {restoreReleaseEncyclopedia} from '../encyclopedia/restore-calculation-index.mjs';
import {assertStagedRuntimeSource, assertStagedCalculatorBuild, readLiveBudgetIdentity} from './catalog-staged-budget.mjs';
import {createResourceNodeInvocation, forwardResourceNodeTelemetry} from './node-resource-memory.mjs';

const run = promisify(execFile);
const child = fileURLToPath(new URL('../catalog-serving-read-model-child.mjs', import.meta.url));
const MAX_LINE = 4 * 1024 ** 2;

export function assertServingProjectionReceipt(receipt) {
  if (!Number.isSafeInteger(receipt?.rows) || receipt.rows < 0
      || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0
      || !/^[a-f0-9]{64}$/.test(receipt.sha256 || '')) throw Error('serving_read_model_receipt_invalid');
}

function assertProjectionRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw Error('serving_read_model_row_invalid');
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const {bytesWritten} = await handle.write(bytes, offset, bytes.length - offset);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) throw Error('serving_read_model_write_incomplete');
    offset += bytesWritten;
  }
}

export async function writeServingProjectionRows(file, rows) {
  if (!rows || typeof rows[Symbol.iterator] !== 'function' && typeof rows[Symbol.asyncIterator] !== 'function') {
    throw Error('serving_read_model_rows_invalid');
  }
  const handle = await fs.open(file, 'wx', 0o600);
  const digest = createHash('sha256');
  let bytes = 0, count = 0, buffer = [], bufferedBytes = 0;
  try {
    for await (const row of rows) {
      assertProjectionRow(row);
      const line = JSON.stringify(row), length = line ? Buffer.byteLength(line) + 1 : 0;
      if (!line || length > MAX_LINE) throw Error('serving_read_model_line_bound');
      if (bufferedBytes + length > MAX_LINE && buffer.length) {
        await writeAll(handle, Buffer.concat(buffer, bufferedBytes)); buffer = []; bufferedBytes = 0;
      }
      const encoded = Buffer.from(line + '\n');
      buffer.push(encoded); digest.update(encoded); bufferedBytes += length; bytes += length; count++;
      if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(count)) throw Error('serving_read_model_receipt_invalid');
    }
    if (buffer.length) await writeAll(handle, Buffer.concat(buffer, bufferedBytes));
  } finally { await handle.close(); }
  return {rows:count, bytes, sha256:digest.digest('hex')};
}

export async function* readServingProjectionRows(file, expected) {
  if (expected !== undefined) assertServingProjectionReceipt(expected);
  const stream = createReadStream(file), digest = createHash('sha256'), decoder = new TextDecoder('utf-8', {fatal:true});
  let count = 0, bytes = 0, parts = [], lineBytes = 0;
  try {
    for await (const chunk of stream) {
      digest.update(chunk); bytes += chunk.length;
      if (!Number.isSafeInteger(bytes) || expected && bytes > expected.bytes) throw Error('serving_read_model_transfer_changed');
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset), end = newline === -1 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        lineBytes += part.length;
        if (lineBytes + 1 > MAX_LINE) throw Error('serving_read_model_line_bound');
        if (part.length) parts.push(part);
        if (newline === -1) break;
        if (!lineBytes) throw Error('serving_read_model_row_invalid');
        let row;
        try { row = JSON.parse(decoder.decode(Buffer.concat(parts, lineBytes))); }
        catch { throw Error('serving_read_model_row_invalid'); }
        assertProjectionRow(row);
        parts = []; lineBytes = 0; count++;
        if (!Number.isSafeInteger(count) || expected && count > expected.rows) throw Error('serving_read_model_input_incomplete');
        yield row;
        offset = newline + 1;
      }
    }
    if (lineBytes) throw Error('serving_read_model_input_truncated');
    if (expected && count !== expected.rows) throw Error('serving_read_model_input_incomplete');
    const sha256 = digest.digest('hex');
    if (expected && (bytes !== expected.bytes || sha256 !== expected.sha256)) throw Error('serving_read_model_transfer_changed');
  } finally { stream.destroy(); }
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
 * JSONL buffers and individual records are bounded, not the complete inventory.
 * Only one child runs, even for parallel markets; receipts cover every byte/row.
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
        const file = path.join(directory, 'input-' + ++sequence + '.jsonl');
        input = {file, receipt:await writeServingProjectionRows(file, rows)};
        inputs.set(rows, input);
      }
      if (input.receipt.rows !== rows.length) throw Error('serving_read_model_input_incomplete');
      const output = path.join(directory, 'output-' + ++sequence + (task === 'budget' ? '.jsonl' : '.json'));
      const requestPath = path.join(directory, 'request-' + sequence + '.json'), reportPath = output + '.receipt.json';
      await fs.writeFile(requestPath, JSON.stringify({task, input:input.file, inputReceipt:input.receipt,
        output, reportPath, rows:rows.length, ...details}), {mode:0o600});
      const invocation = await createResourceNodeInvocation({
        args:['--import', 'tsx', child, root, contextPath, requestPath],
        env:{...process.env, AVTOCENA_RELEASE_SHA:release, AVTOCENA_CALCULATION_VERSION:identity.calculationVersion},
        role:'serving-read-model',
      });
      try {
        const {stderr} = await run(process.execPath, invocation.args, {
          cwd:root, env:invocation.env,
          timeout:10 * 60_000, maxBuffer:64 * 1024,
        });
        forwardResourceNodeTelemetry(stderr);
      } catch (error) {
        forwardResourceNodeTelemetry(error.stderr);
        throw error;
      }
      if ((await fs.stat(reportPath)).size > 4096) throw Error('serving_read_model_receipt_invalid');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (report.task !== task || report.inputRows !== input.receipt.rows) throw Error('serving_read_model_receipt_invalid');
      let result;
      if (task === 'budget') {
        assertServingProjectionReceipt(report.output);
        if (report.output.rows > report.inputRows) throw Error('serving_read_model_budget_identity_invalid');
        result = [];
        for await (const row of readServingProjectionRows(output, report.output)) result.push(row);
      } else {
        if ((await fs.stat(output)).size > 32 * 1024 ** 2) throw Error('serving_read_model_result_bound');
        const body = await fs.readFile(output);
        if (!report.output || body.length !== report.output.bytes
            || createHash('sha256').update(body).digest('hex') !== report.output.sha256) throw Error('serving_read_model_transfer_changed');
        result = JSON.parse(body.toString('utf8'));
      }
      await fs.rm(output); await fs.rm(reportPath);
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
