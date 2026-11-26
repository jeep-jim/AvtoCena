import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CRM_JAPAN_PHOTO_CODE_SCOPE} from '../scripts/catalog-next/crm-japan-photo-code-scope.mjs';
import {JAPAN_PAGINATION_CODE_SCOPE} from '../scripts/catalog-next/japan-pagination-code-scope.mjs';
import {checkedJapanPhotoRetryBrowserFixture, readJapanPhotoRetryFixture, checkedJapanPhotoRetryEvidence,
  JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES} from '../scripts/catalog-next/japan-photo-retry-proof.mjs';

const sha = raw => createHash('sha256').update(raw).digest('hex');
const fixture = () => ({version: 1, kind: 'japan-photo-retry-browser-v1', passed: true, widths: [1440, 390], caseCount: 12,
  checks: {transientRecovery: true, persistentFailureBound: true, sourceChangeCancellation: true, unmountCancellation: true,
    exactUrl: true, noExternalRequests: true, protectedPhotoPreserved: true, lazyLoadRecovery: true}});
const context = () => ({candidate: {runtimeSha: '1'.repeat(40)}, nonce: '2'.repeat(32), oracleSha256: '3'.repeat(64),
  codeScope: CRM_JAPAN_PHOTO_CODE_SCOPE, startedAt: Date.parse('2026-11-26T20:00:00.000Z'), now: Date.parse('2026-11-26T20:01:00.000Z')});
const evidence = (raw = Buffer.from(JSON.stringify(fixture()) + '\n')) => ({version: 1, kind: 'japan-photo-retry-proof-v1',
  codeScope: CRM_JAPAN_PHOTO_CODE_SCOPE, release: context().candidate.runtimeSha, nonce: context().nonce,
  checkedAt: '2026-11-26T20:00:30.000Z', oracleSha256: context().oracleSha256, fixtureBase64: raw.toString('base64'),
  fixtureSha256: sha(raw), passed: true, directSupplierRequests: 0, productionMutations: 0});
const refused = fn => assert.throws(fn, /^Error: japan_photo_retry_proof_[a-z_]+$/);

test('fixture requires both widths and all twelve actual component scenarios', () => {
  assert.deepEqual(checkedJapanPhotoRetryBrowserFixture(fixture()), fixture());
  for (const patch of [{version: 2}, {kind: 'other'}, {passed: false}, {caseCount: 11}, {caseCount: '12'},
    {widths: [390, 1440]}, {widths: [1440]}, {widths: [1440, 390, 800]}, {widths: ['1440', 390]}, {extra: true}]) {
    refused(() => checkedJapanPhotoRetryBrowserFixture({...fixture(), ...patch}));
  }
  for (const key of Object.keys(fixture().checks)) {
    for (const bad of [false, 1, 'true', undefined]) refused(() => checkedJapanPhotoRetryBrowserFixture({
      ...fixture(), checks: {...fixture().checks, [key]: bad}}));
  }
  refused(() => checkedJapanPhotoRetryBrowserFixture({...fixture(), checks: {...fixture().checks, extra: true}}));
});

test('evidence binds the exact runtime, new scope, release nonce, oracle and current check interval', () => {
  assert.deepEqual(checkedJapanPhotoRetryEvidence(evidence(), context()), evidence());
  for (const patch of [{release: '4'.repeat(40)}, {nonce: '5'.repeat(32)}, {oracleSha256: '6'.repeat(64)},
    {codeScope: 'catalog-crm-china-operations-v1'}, {kind: 'other'}, {version: 2}, {passed: false},
    {directSupplierRequests: 1}, {productionMutations: 1}, {directSupplierRequests: '0'}, {extra: 'secret'}]) {
    refused(() => checkedJapanPhotoRetryEvidence({...evidence(), ...patch}, context()));
  }
  for (const checkedAt of ['2026-11-26T19:59:59.999Z', '2026-11-26T20:01:00.001Z',
    '2026-11-26T20:00:30Z', '2026-11-26T23:00:30.000+03:00', 'not-a-date']) {
    refused(() => checkedJapanPhotoRetryEvidence({...evidence(), checkedAt}, context()));
  }
  for (const patch of [{codeScope: undefined}, {codeScope: 'catalog-crm-china-operations-v1'},
    {candidate: {runtimeSha: 'bad'}}, {nonce: 'bad'}, {oracleSha256: 'bad'}, {startedAt: NaN}, {now: 0}]) {
    refused(() => checkedJapanPhotoRetryEvidence(evidence(), {...context(), ...patch}));
  }
});

test('embedded fixture is bounded, hash-checked and parsed instead of trusting its passed flag', () => {
  for (const patch of [{fixtureBase64: evidence().fixtureBase64 + '\n'}, {fixtureSha256: '0'.repeat(64)},
    {fixtureBase64: ''}, {fixtureBase64: '!!!!'}, {fixtureSha256: 'not-a-hash'}]) {
    refused(() => checkedJapanPhotoRetryEvidence({...evidence(), ...patch}, context()));
  }
  for (const raw of [Buffer.from('not-json'), Buffer.from(JSON.stringify({...fixture(), passed: false})),
    Buffer.from(JSON.stringify({...fixture(), checks: {...fixture().checks, noExternalRequests: false}})),
    Buffer.alloc(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES + 1, 32), Buffer.from([0xff])]) {
    refused(() => checkedJapanPhotoRetryEvidence(evidence(raw), context()));
  }
  const raw = Buffer.from(JSON.stringify(fixture()));
  const padded = Buffer.concat([raw, Buffer.alloc(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES - raw.length, 32)]);
  assert.equal(checkedJapanPhotoRetryEvidence(evidence(padded), context()).fixtureSha256, sha(padded));
});

test('untrusted accessors and private extras are refused without invocation or echo', () => {
  let calls = 0;
  const report = fixture();
  Object.defineProperty(report.checks, 'exactUrl', {enumerable: true, get() { calls++; throw Error('private-password'); }});
  refused(() => checkedJapanPhotoRetryBrowserFixture(report));
  const wrapped = evidence();
  Object.defineProperty(wrapped, 'fixtureBase64', {enumerable: true, get() { calls++; return 'private-password'; }});
  refused(() => checkedJapanPhotoRetryEvidence(wrapped, context()));
  refused(() => checkedJapanPhotoRetryEvidence({...evidence(), password: 'private-password'}, context()));
  assert.equal(calls, 0);
});

async function directory(t) {
  const location = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-photo-proof-'));
  t.after(() => fs.rm(location, {recursive: true, force: true}));
  return location;
}

test('artifact reader returns the original bounded bytes from a regular canonical single-link file', async t => {
  const dir = await directory(t), file = path.join(dir, 'report.json');
  const raw = Buffer.from(JSON.stringify(fixture(), null, 2) + '\n');
  await fs.writeFile(file, raw);
  assert.deepEqual(await readJapanPhotoRetryFixture(file), raw);
});

test('artifact reader rejects missing, directory, oversized, malformed and noncanonical paths', async t => {
  const dir = await directory(t), file = path.join(dir, 'report.json');
  await assert.rejects(readJapanPhotoRetryFixture(path.join(dir, 'missing.json')), /japan_photo_retry_proof_/);
  await assert.rejects(readJapanPhotoRetryFixture(dir), /japan_photo_retry_proof_/);
  await fs.writeFile(file, Buffer.alloc(JAPAN_PHOTO_RETRY_FIXTURE_MAX_BYTES + 1, 32));
  await assert.rejects(readJapanPhotoRetryFixture(file), /japan_photo_retry_proof_/);
  await fs.writeFile(file, JSON.stringify({...fixture(), passed: false}));
  await assert.rejects(readJapanPhotoRetryFixture(file), /japan_photo_retry_proof_/);
  await fs.writeFile(file, JSON.stringify(fixture()));
  await assert.rejects(readJapanPhotoRetryFixture(dir + '/./report.json'), /japan_photo_retry_proof_/);
  await assert.rejects(readJapanPhotoRetryFixture('report.json'), /japan_photo_retry_proof_/);
});

test('artifact reader refuses direct and parent symlinks and hard-linked reports', async t => {
  const dir = await directory(t), file = path.join(dir, 'report.json'), link = path.join(dir, 'link.json');
  await fs.writeFile(file, JSON.stringify(fixture()));
  await fs.symlink(file, link);
  await assert.rejects(readJapanPhotoRetryFixture(link), /japan_photo_retry_proof_/);
  const real = path.join(dir, 'real'), parentLink = path.join(dir, 'alias');
  await fs.mkdir(real); await fs.writeFile(path.join(real, 'report.json'), JSON.stringify(fixture()));
  await fs.symlink(real, parentLink, 'dir');
  await assert.rejects(readJapanPhotoRetryFixture(path.join(parentLink, 'report.json')), /japan_photo_retry_proof_/);
  await fs.link(file, path.join(dir, 'hard.json'));
  await assert.rejects(readJapanPhotoRetryFixture(file), /japan_photo_retry_proof_/);
});

test('artifact identity changing during the bounded read cannot be promoted into evidence', async t => {
  const dir = await directory(t), file = path.join(dir, 'report.json');
  await fs.writeFile(file, JSON.stringify(fixture()));
  const open = fs.open;
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (args[0] === file) {
      const read = handle.read.bind(handle); let changed = false;
      handle.read = async (...input) => {
        const result = await read(...input);
        if (!changed) { changed = true; await fs.utimes(file, new Date(0), new Date(1000)); }
        return result;
      };
    }
    return handle;
  };
  try { await assert.rejects(readJapanPhotoRetryFixture(file), /japan_photo_retry_proof_fixture_changed/); }
  finally { fs.open = open; }
});

test('pagination24 inherits the same exact photo fixture without relabeling an old release proof',()=>{
  const report={...evidence(),codeScope:JAPAN_PAGINATION_CODE_SCOPE},expected={...context(),codeScope:JAPAN_PAGINATION_CODE_SCOPE};
  assert.deepEqual(checkedJapanPhotoRetryEvidence(report,expected),report);
  refused(()=>checkedJapanPhotoRetryEvidence(report,context()));
  refused(()=>checkedJapanPhotoRetryEvidence(evidence(),expected));
  for(const patch of [{fixtureSha256:'0'.repeat(64)},{release:'9'.repeat(40)},{nonce:'a'.repeat(32)},
    {checkedAt:'2026-11-26T19:59:59.000Z'},{directSupplierRequests:1}])
    refused(()=>checkedJapanPhotoRetryEvidence({...report,...patch},expected));
});
