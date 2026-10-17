import fs from 'node:fs/promises';
import { ObjectJsonStorage } from '../apps/web/lib/data.ts';

// Delete only this assistant's exact, already recorded diagnostic image keys.
// This is not the catalog cleanup command and cannot list or modify live data.
const plan = JSON.parse(await fs.readFile('data/catalog/research/canary-image-copy-removal-plan-v1-20260907.json', 'utf8'));
const allowedRuns = new Set(['34073795968-1/europe', '34073795968-1/korea', '34074192666-1/europe']);
const reports = new Set();
const images = new Set();
for (const run of plan.runs) {
  if (!allowedRuns.delete(`${run.runId}/${run.market}`)) throw new Error('cleanup_run_not_owned');
  const prefix = `catalog/canaries/${run.runId}/${run.market}/`;
  if (run.reportKey !== `${prefix}report.json`) throw new Error('cleanup_report_key_invalid');
  reports.add(run.reportKey);
  for (const file of run.files) {
    if (file.key !== `${prefix}catalog/images/${run.market}/${file.sha256}.webp`
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !(file.bytes > 0) || images.has(file.key)) throw new Error('cleanup_image_key_invalid');
    images.add(file.key);
  }
}
if (allowedRuns.size || images.size !== 148 || plan.expectedFiles !== 148) throw new Error('cleanup_scope_invalid');
const endpoint = new URL(process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net');
const configuredPrefix = (process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const root = `${endpoint.pathname.replace(/\/$/, '')}/${process.env.YC_OBJECT_STORAGE_BUCKET}/${configuredPrefix ? `${configuredPrefix}/` : ''}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = String(init.method || 'GET').toUpperCase();
  const pathname = decodeURIComponent(url.pathname);
  const key = pathname.startsWith(root) ? pathname.slice(root.length) : '';
  if (url.origin !== endpoint.origin || url.search || !(method === 'GET' && reports.has(key)
    || ['HEAD', 'DELETE'].includes(method) && images.has(key))) throw new Error('cleanup_request_outside_exact_plan');
  const response = await originalFetch(input, { ...init, redirect: 'error' });
  if (!response.ok && response.status !== 404) throw new Error(`cleanup_http_${response.status}`);
  return response;
};
const storage = new ObjectJsonStorage();
const result = { version: 1, startedAt: new Date().toISOString(), expectedFiles: images.size,
  expectedBytes: plan.expectedBytes, deleted: 0, alreadyAbsent: 0, verifiedAbsent: 0,
  sourceImageDownloads: 0, liveCatalogDeletes: 0, completed: false, runs: [] };
try {
  // Attest every run against its persisted report before deleting any object.
  for (const run of plan.runs) {
    const saved = await storage.readJson(run.reportKey, null);
    if (!saved?.accepted || saved.runId !== run.runId || saved.market !== run.market || saved.codeSha !== run.codeSha
      || run.files.some(file => !saved.files?.some(row => row.key === file.key && row.sha256 === file.sha256 && row.bytes === file.bytes))) {
      throw new Error('cleanup_saved_report_mismatch');
    }
    result.runs.push({ runId: run.runId, market: run.market, verifiedReport: run.reportKey, images: run.files.length });
  }
  for (const key of images) {
    if (await storage.head(key)) { await storage.deleteJson(key); result.deleted++; }
    else result.alreadyAbsent++;
    if (await storage.head(key)) throw new Error('cleanup_image_still_present');
    result.verifiedAbsent++;
  }
  // These three artifacts were created by the same recorded canary runs.
  // Their JSON reports remain in Object Storage; remove the binary ZIP copies.
  if (process.env.GITHUB_REPOSITORY !== 'jeep-jim/AvtoCena' || !process.env.GITHUB_TOKEN) throw new Error('cleanup_artifact_repository_mismatch');
  result.artifactsRemoved = [];
  for (const [id, runId] of [[10001391217, 34073795968], [10001412782, 34073795968], [10001519426, 34074192666]]) {
    const url = `https://api.github.com/repos/jeep-jim/AvtoCena/actions/artifacts/${id}`;
    const headers = { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' };
    const read = await originalFetch(url, { headers, redirect: 'error' });
    if (read.status === 404) { result.artifactsRemoved.push({ id, alreadyAbsent: true }); continue; }
    if (!read.ok) throw new Error(`cleanup_artifact_read_${read.status}`);
    const artifact = await read.json();
    if (artifact.id !== id || artifact.workflow_run?.id !== runId || !/^generation-canary-(europe|korea)$/.test(artifact.name)) throw new Error('cleanup_artifact_identity_mismatch');
    const deleted = await originalFetch(url, { method: 'DELETE', headers, redirect: 'error' });
    if (deleted.status !== 204) throw new Error(`cleanup_artifact_delete_${deleted.status}`);
    const verify = await originalFetch(url, { headers, redirect: 'error' });
    if (verify.status !== 404) throw new Error('cleanup_artifact_still_present');
    result.artifactsRemoved.push({ id, verifiedAbsent: true });
  }
  result.completed = true;
} catch (error) {
  result.error = String(error?.message || error).slice(0, 200);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  result.finishedAt = new Date().toISOString();
  await fs.writeFile('canary-image-copy-removal-report.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
}
