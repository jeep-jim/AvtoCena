import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const CONTROLS_KEY = 'catalog/operations/collection-controls-v1.json';
export const JAPAN_ACCESS_KEY = 'integrations/ajes/config.json';
export const RETIRED_SOURCE_IDS = Object.freeze(['ajes_china_feed', 'ajes_korea_feed']);
const REQUIRED_MARKETS = ['china', 'japan', 'korea', 'uae', 'europe', 'georgia'];
const REQUIRED_SOURCES = ['ajes_japan_feed', 'encar_feed', 'dubicars_feed', 'che168_feed',
  'autohome_used_china_open', 'autohome_new_china_open', 'encar_direct', 'kcar_korea_open',
  'dubizzle_uae_open', 'dubicars_uae_exact', 'carswitch_uae_open', 'mobile_de_open',
  'autoscout_europe_open', 'myauto_georgia_list', 'autopapa_georgia_open', 'akebono_green'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = value => Buffer.from(JSON.stringify(value));
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const sameHead = (left, right) => left.found === right.found && (!left.found || left.etag === right.etag);

function keptSettings(value) {
  const copy = structuredClone(value);
  for (const id of RETIRED_SOURCE_IDS) delete copy.sources[id];
  delete copy.revision;
  delete copy.updatedAt;
  return copy;
}

function validate(value) {
  assert(record(value) && value.version === 1 && Number.isSafeInteger(value.revision)
    && value.revision >= 0 && value.revision < Number.MAX_SAFE_INTEGER
    && record(value.markets) && record(value.sources) && Array.isArray(value.history), 'aj_controls_invalid');
  for (const field of ['markets', 'sources']) for (const item of Object.values(value[field]))
    assert(record(item) && typeof item.enabled === 'boolean', 'aj_controls_invalid');
  for (const [field, ids] of [['markets', REQUIRED_MARKETS], ['sources', REQUIRED_SOURCES]])
    for (const id of ids) {
      const item = value[field][id];
      assert(record(item) && typeof item.enabled === 'boolean'
        && [item.enabledAt, item.disabledAt].every(at => at === null
          || (typeof at === 'string' && Number.isFinite(Date.parse(at)))), 'aj_controls_required_row');
    }
}

async function immutableCopy(storage, key, body) {
  try { await storage.putBinary(key, body, 'application/json', {ifNoneMatch: '*'}); }
  catch (error) { if (error?.name !== 'StorageConflictError') throw Error('aj_settings_backup_write_failed'); }
  const result = await storage.getBinary(key);
  assert(Buffer.isBuffer(result?.data) && result.data.equals(body), 'aj_settings_backup_readback_failed');
  return sha(body);
}

/** One owner-authorized settings migration, not a catalog or supplier operation.
 * Only the two retired AJ source entries and control revision/time may change.
 * The shared encrypted Japan access object is HEAD-only and never decrypted.
 */
export async function retireAjesNonJapanControls({storage, runId, attempt, sourceSha, now = Date.now}) {
  assert(storage?.driver === 'object' && ['readJsonWithMeta', 'readObjectMetadata', 'getBinary', 'putBinary']
    .every(method => typeof storage[method] === 'function'), 'aj_object_storage_required');
  assert(/^[1-9]\d{0,19}$/.test(String(runId)) && /^[1-9]\d{0,5}$/.test(String(attempt))
    && /^[a-f0-9]{40}$/.test(sourceSha ?? ''), 'aj_operation_identity');
  const root = `settings-backups/ajes-japan-only/20261124/${runId}/${attempt}`;
  const japanBefore = await storage.readObjectMetadata(JAPAN_ACCESS_KEY);
  assert(typeof japanBefore?.found === 'boolean' && (!japanBefore.found || japanBefore.etag), 'aj_japan_access_metadata');
  const before = await storage.readJsonWithMeta(CONTROLS_KEY, null);
  assert(before.found && typeof before.etag === 'string' && before.etag, 'aj_controls_required');
  validate(before.value);
  const retired = RETIRED_SOURCE_IDS.filter(id => Object.hasOwn(before.value.sources, id));
  if (!retired.length) {
    assert(sameHead(japanBefore, await storage.readObjectMetadata(JAPAN_ACCESS_KEY)), 'aj_japan_access_changed');
    return {version: 1, applied: false, alreadyRetired: true, removedSources: [],
      revision: before.value.revision, japanAccessUnchanged: true, otherSettingsUnchanged: true};
  }
  const beforeBody = bytes(before.value);
  const backupSha256 = await immutableCopy(storage, root + '/collection-controls-before.json', beforeBody);
  const at = new Date(now()).toISOString();
  const next = {...structuredClone(before.value), revision: before.value.revision + 1, updatedAt: at};
  for (const id of RETIRED_SOURCE_IDS) delete next.sources[id];
  assert.deepEqual(keptSettings(next), keptSettings(before.value), 'aj_protected_settings_changed');
  assert(sameHead(japanBefore, await storage.readObjectMetadata(JAPAN_ACCESS_KEY)), 'aj_japan_access_changed');
  const afterBody = bytes(next);
  let putError;
  try { await storage.putBinary(CONTROLS_KEY, afterBody, 'application/json', {ifMatch: before.etag}); }
  catch (error) { putError = error; }
  // A timed-out CAS may have succeeded. Confirm the exact result, never retry
  // with a newly observed ETag or overwrite a concurrent owner's change.
  const after = await storage.readJsonWithMeta(CONTROLS_KEY, null);
  if (!after.found || !after.etag || !bytes(after.value).equals(afterBody))
    throw Error(putError?.name === 'StorageConflictError' ? 'aj_settings_conflict' : 'aj_settings_readback_mismatch');
  assert(after.etag !== before.etag, 'aj_settings_revision_not_written');
  assert(sameHead(japanBefore, await storage.readObjectMetadata(JAPAN_ACCESS_KEY)), 'aj_japan_access_changed');
  const receipt = {version: 1, operation: 'retire-aj-outside-japan', sourceSha,
    runId: String(runId), attempt: String(attempt), at, removedSources: retired,
    beforeRevision: before.value.revision, afterRevision: next.revision,
    beforeValueSha256: backupSha256, afterValueSha256: sha(afterBody),
    preservedSettingsSha256: sha(bytes(keptSettings(next))),
    japanAccessPresent: japanBefore.found, japanAccessUnchanged: true,
    otherSettingsUnchanged: true, catalogWrites: 0, supplierRequests: 0};
  const receiptSha256 = await immutableCopy(storage, root + '/receipt.json', bytes(receipt));
  return {version: 1, applied: true, alreadyRetired: false, removedSources: retired,
    revision: next.revision, japanAccessUnchanged: true, otherSettingsUnchanged: true,
    catalogWrites: 0, supplierRequests: 0, receiptSha256};
}

async function main() {
  assert(process.env.AJ_JAPAN_ONLY_APPLY === 'true' && process.env.JSON_STORAGE_DRIVER === 'object', 'aj_apply_not_authorized');
  assert(process.env.YC_OBJECT_STORAGE_ENDPOINT === 'https://s3.regru.cloud'
    && process.env.YC_OBJECT_STORAGE_BUCKET === 'avtocena-staging-8120751'
    && process.env.YC_OBJECT_STORAGE_PREFIX === 'migration-staging/full-20261011/', 'aj_storage_scope');
  const output = process.env.AJ_JAPAN_ONLY_REPORT;
  assert(output && path.isAbsolute(output), 'aj_report_path');
  const {getJsonStorage} = await import('../../../apps/web/lib/data.ts');
  const report = await retireAjesNonJapanControls({storage: getJsonStorage(),
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, sourceSha: process.env.GITHUB_SHA});
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify(report));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('AJ source settings retirement failed; inspect the scoped private backup and current revision.'); process.exitCode = 1; });
}
