import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectJapanPowerSql, summarizeSqlStructure, summarizeBoundSavedFailure, verifyJapanPowerSqlInvocation,
  PROFILE, LIMIT, SAFE_REGEXPS, MARKER, OPERATION, WORKFLOW}
  from '../scripts/catalog-next/inspect-japan-power-sql-20261128.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const now = Date.parse('2026-11-28T17:00:00.000Z');
const env = {REGCLOUD_S3_ACCESS_KEY_ID: 'fake_test_access', REGCLOUD_S3_SECRET_ACCESS_KEY: 'fake-test-secret-never-real'};
const fixedUrl = 'https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/' + PROFILE.key;
const canaries = ['PRIVATE_MODEL_ALPHA', 'PRIVATE_MODEL_BETA', 'PRIVATE_MAKE_ALPHA', 'PRIVATE_MAKE_BETA',
  'PRIVATE_HEAVY_ALPHA', 'PRIVATE_HEAVY_BETA', 'PRIVATE_ID_ALPHA', 'PRIVATE_ID_BETA', 'PRIVATE_COLUMN',
  'PRIVATE_PASSWORD_123', '198.51.100.237', 'https://private-endpoint.invalid/api/'];
const sql = "select * from stats where year>=2008 and year<=2027 and not (marka_name in ('PRIVATE_MAKE_ALPHA','PRIVATE_MAKE_BETA')"
  + " and model_name regexp '^(PRIVATE_HEAVY_ALPHA|PRIVATE_HEAVY_BETA)($|[ /-])') and ((pw regexp '" + SAFE_REGEXPS[0]
  + "' and pw>=1 and pw<=160) or (pw regexp '" + SAFE_REGEXPS[1] + "' or pw like '%&%')"
  + " or (model_name in ('PRIVATE_MODEL_ALPHA','PRIVATE_MODEL_BETA') and year in (2012,2013))"
  + " or (model_name='PRIVATE_MODEL_ALPHA' and year=2014) or id in ('PRIVATE_ID_ALPHA','PRIVATE_ID_BETA'))"
  + ' order by data desc,id desc limit 0,24';
const binding = {...PROFILE, sqlSha256: hash(sql), sqlBytes: Buffer.byteLength(sql)};
const record = (change = {}) => ({table: 'stats', kind: 'list', page: 1, pageSize: 24, httpStatus: 500, outcome: 'http_500',
  startedAt: '2026-11-28T16:40:00.000Z', finishedAt: '2026-11-28T16:40:00.169Z', sql,
  clientIp: canaries[10], endpoint: canaries[11], password: canaries[9], responseBody: canaries.join(' '), ...change});
const absentSecrets = value => {
  const text = JSON.stringify(value);
  for (const canary of [...canaries, env.REGCLOUD_S3_ACCESS_KEY_ID, env.REGCLOUD_S3_SECRET_ACCESS_KEY])
    assert.equal(text.toLowerCase().includes(canary.toLowerCase()), false, canary);
  assert.equal(text.includes(sql), false);
};

test('one immutable saved slot and wire SQL digest bind this diagnostic', async () => {
  assert.equal(PROFILE.key, 'integrations/ajes/catalog-failure-pages/stats-list-1.json');
  assert.equal(PROFILE.sqlSha256, '1880ccb86d834592edaf932d2f31fcd361fdf1ede96b397e18d33b33216310da');
  assert.equal(PROFILE.sqlBytes, 3982); assert.equal(LIMIT.objects, 1);
  assert(Object.isFrozen(PROFILE)); assert(Object.isFrozen(LIMIT));
});

test('whitelist projection preserves structure and literal counts while discarding every private value', () => {
  const report = summarizeBoundSavedFailure(record(), binding), structure = report.structure;
  assert.equal(report.readStatus, 'matched'); assert.equal(report.durationMs, 169);
  assert.equal(structure.lexical.balancedParentheses, true);
  assert.equal(structure.lexical.serverSyntaxValidated, false); assert.equal(structure.lexical.serverSqlModeKnown, false);
  assert.match(structure.template, /pw regexp <regexp> and pw >= <number> and pw <= <number>/);
  assert.match(structure.template, /model_name in \( <string> , <string> \)/);
  assert.deepEqual(structure.comparisonLiteralCounts.models,
    {comparisonPredicates: 1, inPredicates: 1, regexpPredicates: 1, literalOccurrences: 3, distinctLiteralSpellings: 2});
  assert.equal(structure.comparisonLiteralCounts.years.literalOccurrences, 5);
  assert.equal(structure.comparisonLiteralCounts.years.distinctLiteralSpellings, 5);
  assert.equal(structure.comparisonLiteralCounts.ids.literalOccurrences, 2);
  assert.equal(structure.comparisonLiteralCounts.ids.distinctLiteralSpellings, 2);
  assert.equal(structure.regexps[0].policy, 'metacharacters_only');
  assert.equal(structure.regexps[0].shape, '^(<text>|<text>)($|[ /-])');
  assert.equal(structure.regexps[0].pipeCharacters, 2);
  assert.deepEqual(structure.regexps.slice(1).map(value => value.literal), SAFE_REGEXPS.slice(0, 2));
  assert.equal(structure.encoding.sqlUtf8Bytes, Buffer.byteLength(sql));
  assert.equal(structure.encoding.sqlFormEncodedBytes, new URLSearchParams({sql}).toString().length - 4);
  assert.equal(structure.encoding.queryWithSyntheticCredentialsBytes,
    Buffer.byteLength(new URLSearchParams({ip: '192.0.2.1', json: '', code: 'fake-code', sql}).toString()));
  assert.equal(structure.encoding.actualCredentialAndEndpointLengthsUsed, false);
  absentSecrets(report);
});

test('strings, quoted identifiers, comments and arbitrary regexp text cannot become template vocabulary', () => {
  const value = "select `PRIVATE_COLUMN`, upper(trim(model_name)) from stats where model_name='PRIVATE_MODEL_ALPHA''PRIVATE_PASSWORD_123'"
    + " and id='PRIVATE_ID_ALPHA' and model_name regexp '^PRIVATE_MODEL_BETA[0-9]{12345}$' /* PRIVATE_PASSWORD_123 */ -- PRIVATE_MAKE_ALPHA\n";
  const report = summarizeSqlStructure(value);
  assert.deepEqual(report.functions, {upper: 1, trim: 1});
  assert.equal(report.lexical.comments, 2); assert.equal(report.lexical.unknownIdentifiers, 1);
  assert.equal(report.regexps[0].policy, 'metacharacters_only');
  assert.equal(report.regexps[0].shape.includes('12345'), false);
  absentSecrets(report);
  for (const text of ["select 'PRIVATE_PASSWORD_123", 'select /* PRIVATE_PASSWORD_123', 'select /*! PRIVATE_PASSWORD_123 */'])
    assert.throws(() => summarizeSqlStructure(text), /unclosed_quote|unclosed_comment|executable_comment/);
  assert.equal(summarizeSqlStructure('select (1').lexical.balancedParentheses, false);
  assert.throws(() => summarizeSqlStructure(' '.repeat(LIMIT.sqlBytes + 1)), /sql_bounds/);
  assert.throws(() => summarizeSqlStructure('('.repeat(LIMIT.depth + 1)), /depth_limit/);
});

test('hash mismatch never analyzes another request and record metadata must independently match', () => {
  const mismatch = summarizeBoundSavedFailure(record());
  assert.equal(mismatch.readStatus, 'sql_binding_mismatch'); assert.equal(mismatch.structure, undefined);
  absentSecrets(mismatch);
  for (const change of [{table: 'main'}, {page: 2}, {pageSize: 48}, {httpStatus: 403}, {outcome: 'visitor_restricted'},
    {startedAt: canaries[9]}, {finishedAt: '2026-11-27T00:00:00.000Z'}])
    assert.throws(() => summarizeBoundSavedFailure(record(change), binding), /record_binding/);
  assert.throws(() => summarizeBoundSavedFailure(record(), {...binding, httpStatus: canaries[9]}), /binding_invalid/);
  let invoked = false;
  assert.throws(() => summarizeBoundSavedFailure({get sql() { invoked = true; throw Error(canaries[9]); }}), /record_invalid/);
  assert.equal(invoked, false);
});

test('transport makes exactly one GET, ignores all target overrides and never follows redirects or histories', async () => {
  const calls = [];
  const result = await inspectJapanPowerSql({env: {...env,
    get AJES_API_PASSWORD() { throw Error('must not read supplier credentials'); },
    get YC_OBJECT_STORAGE_ENDPOINT() { throw Error('must not read endpoint override'); }}, now: () => now,
    fetcher: async (url, options) => { calls.push({url: url.href, ...options}); return new Response(JSON.stringify(record())); }});
  assert.equal(calls.length, 1); assert.equal(calls[0].url, fixedUrl);
  assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].redirect, 'error'); assert.equal(calls[0].body, undefined);
  assert.equal(result.objectGets, 1); assert.equal(result.readStatus, 'sql_binding_mismatch'); assert.equal(result.completed, false);
  for (const key of ['historyReads', 'bucketListings', 'supplierRequests', 'hostRequests', 'storageWrites']) assert.equal(result[key], 0);
  assert.equal(result.structure, undefined); absentSecrets(result);
  for (const override of [{key: 'other'}, {sqlSha256: binding.sqlSha256}, {binding}, {url: fixedUrl}])
    await assert.rejects(inspectJapanPowerSql({...override, env, fetcher: () => { throw Error('must not call'); }}), /options/);
});

test('missing, refused, malformed, compressed and oversized storage responses produce only bounded codes', async () => {
  for (const [status, response] of [
    ['missing', () => new Response(canaries[9], {status: 404})],
    ['unavailable', () => new Response(canaries[9], {status: 403})],
    ['unavailable', () => new Response(canaries[9], {status: 302, headers: {location: canaries[11]}})],
    ['body_invalid', () => new Response(canaries[9])], ['body_invalid', () => new Response(new Uint8Array([255]))],
    ['encoding', () => new Response('{}', {headers: {'content-encoding': 'gzip'}})],
    ['byte_limit', () => new Response('x'.repeat(LIMIT.objectBytes + 1))],
    ['byte_limit', () => new Response('{}', {headers: {'content-length': String(LIMIT.objectBytes + 1)}})],
    ['body_size', () => new Response('{}', {headers: {'content-length': '3'}})],
    ['unavailable', () => { throw Error(canaries[9] + env.REGCLOUD_S3_SECRET_ACCESS_KEY); }],
  ]) {
    let calls = 0;
    const report = await inspectJapanPowerSql({env, now: () => now, fetcher: () => { calls++; return response(); }});
    assert.equal(calls, 1); assert.equal(report.readStatus, status); assert.equal(report.completed, false);
    assert(report.acceptedResponseBytes <= LIMIT.objectBytes); assert.equal(report.structure, undefined); absentSecrets(report);
  }
});

test('both a hung fetch and a hung stream honor the deadline without retrying', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  for (const stream of [false, true]) {
    let calls = 0;
    const pending = inspectJapanPowerSql({env, now: () => now, fetcher: () => {
      calls++; return stream ? new Response(new ReadableStream({pull() { return new Promise(() => {}); }})) : new Promise(() => {});
    }});
    await Promise.resolve(); await Promise.resolve(); t.mock.timers.tick(LIMIT.totalMs);
    const report = await pending; assert.equal(calls, 1); assert.equal(report.readStatus, 'deadline'); absentSecrets(report);
  }
  const absent = await inspectJapanPowerSql({env: {}, fetcher: () => { throw Error('must not call'); }});
  assert.equal(absent.objectGets, 0); assert.equal(absent.readStatus, 'configuration_unavailable');
});

test('only the exact inspect job and a separate marker-only push can read credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-power-sql-invocation-'));
  const git = args => execFileSync('git', ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    {cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    git(['init', '-q', '--initial-branch=main']); await fs.mkdir(path.join(directory, '.github/market-runs'), {recursive: true});
    await fs.writeFile(path.join(directory, 'controller.txt'), 'reviewed controller'); git(['add', '.']); git(['commit', '-qm', 'controller']);
    const approved = git(['rev-parse', 'HEAD']);
    await fs.writeFile(path.join(directory, MARKER), JSON.stringify({version: 1, operation: OPERATION, approvedSourceSha: approved}));
    git(['add', '.']); git(['commit', '-qm', 'marker']); const head = git(['rev-parse', 'HEAD']);
    const event = path.join(directory, 'event.json');
    await fs.writeFile(event, JSON.stringify({before: approved, after: head, ref: 'refs/heads/main', created: false, deleted: false, forced: false}));
    const environment = {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: WORKFLOW, GITHUB_JOB: 'inspect',
      GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: head, GITHUB_EVENT_PATH: event};
    assert.equal(verifyJapanPowerSqlInvocation({root: directory, environment}).approvedSourceSha, approved);
    for (const changed of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_WORKFLOW_REF: WORKFLOW + '-other'}, {GITHUB_JOB: 'release'},
      {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_REPOSITORY_ID: '1'}])
      assert.throws(() => verifyJapanPowerSqlInvocation({root: directory, environment: {...environment, ...changed}}));
    await fs.writeFile(path.join(directory, 'controller.txt'), 'dirty controller');
    assert.throws(() => verifyJapanPowerSqlInvocation({root: directory, environment}), /readonly_invocation_/);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('workflow exposes only fixed read credentials after verification; the script has no writer or application transport', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const workflow = await fs.readFile(path.join(root, '.github/workflows/japan-power-sql-20261128-readonly.yml'), 'utf8');
  const scriptPath = path.join(root, 'scripts/catalog-next/inspect-japan-power-sql-20261128.mjs');
  const script = await fs.readFile(scriptPath, 'utf8');
  assert.match(workflow, /timeout-minutes: 2/); assert.match(workflow, /fetch-depth: 2/);
  assert.equal(workflow.includes('workflow_dispatch'), false);
  assert.ok(workflow.indexOf('--verify') < workflow.indexOf('secrets.REGCLOUD_S3_ACCESS_KEY_ID'));
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]),
    ['REGCLOUD_S3_ACCESS_KEY_ID', 'REGCLOUD_S3_SECRET_ACCESS_KEY']);
  assert.equal(/SSH_PRIVATE_KEY|AJES_|npm ci|curl|wget/.test(workflow), false);
  assert.equal(/from ['"](?:node:fs|.*apps\/)|writeFile|appendFile|unlink|rename|mkdir|method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(script), false);
  assert.equal((script.match(/fetcher\(/g) || []).length, 1);
  assert.match(script, /summarizeBoundSavedFailure\(saved, PROFILE\)/);
  const result = spawnSync(process.execPath, [scriptPath, '--key', canaries[9]], {encoding: 'utf8'});
  assert.equal(result.status, 1); absentSecrets(JSON.parse(result.stdout)); assert.equal(result.stderr, '');
});
