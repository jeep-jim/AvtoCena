import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const exec = promisify(execFile);
const workflow = new URL('../.github/workflows/catalog-market-refresh.yml', import.meta.url);
const helper = fileURLToPath(new URL('../scripts/lib/paid-encar-artifact-binding.mjs', import.meta.url));

async function actualArchiveBlock() {
  const lines = (await fs.readFile(workflow, 'utf8')).split('\n');
  const step = lines.indexOf('      - name: Verify archive bytes before extracting the same-run paid artifact');
  assert.ok(step >= 0, 'the same-run archive step must exist');
  const run = lines.findIndex((line, index) => index > step && line === '        run: |');
  assert.ok(run > step);
  const body = [];
  for (let index = run + 1; index < lines.length; index++) {
    if (!lines[index].trim()) {body.push(''); continue;}
    if (!lines[index].startsWith('          ')) break;
    body.push(lines[index].slice(10));
  }
  const script = body.join('\n') + '\n';
  assert.match(script, /assertPaidEncarArchiveDigest/);
  assert.match(script, /PAID_ARCHIVE_EXTRACT/);
  return script;
}

const zipBuilder = `import pathlib, stat, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w', compression=zipfile.ZIP_STORED) as archive:
    archive.writestr('report.json', sys.argv[3])
    archive.writestr('encar_direct-000001.jsonl', '{"stage":"detail"}\\n')
    if sys.argv[2] == 'traversal':
        archive.writestr('../escaped.json', 'must not escape')
    elif sys.argv[2] == 'symlink':
        link = zipfile.ZipInfo('unsafe-link')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(link, '../escaped.json')
`;

const fakeGh = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const expected = ['api', 'repos/' + process.env.GITHUB_REPOSITORY + '/actions/artifacts/' + process.env.PREPARED_ENCAR_ARTIFACT_ID + '/zip'];
if (JSON.stringify(args) !== JSON.stringify(expected)) {
  process.stderr.write('fixture_unexpected_gh_arguments\\n');
  process.exit(91);
}
fs.appendFileSync(process.env.FIXTURE_GH_CALLS, JSON.stringify(args) + '\\n');
process.stdout.write(fs.readFileSync(process.env.FIXTURE_ZIP));
`;

for (const scenario of ['valid', 'wrong-digest', 'traversal', 'symlink']) {
  test(`actual paid archive workflow safely handles ${scenario}`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paid-encar-archive-'));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    const cwd = path.join(root, 'work'), bin = path.join(root, 'bin'), runner = path.join(root, 'runner');
    await Promise.all([fs.mkdir(path.join(cwd, 'scripts/lib'), {recursive: true}), fs.mkdir(bin), fs.mkdir(runner)]);
    await fs.symlink(helper, path.join(cwd, 'scripts/lib/paid-encar-artifact-binding.mjs'));
    await fs.writeFile(path.join(bin, 'gh'), fakeGh, {mode: 0o700});
    const zip = path.join(root, 'fixture.zip'), calls = path.join(root, 'gh-calls.jsonl');
    const env = {PATH: `${bin}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
      RUNNER_TEMP: runner, GITHUB_REPOSITORY: 'fixture-owner/fixture-repository',
      PREPARED_ENCAR_ARTIFACT_ID: '14178273080', GH_TOKEN: 'fixture-token',
      FIXTURE_ZIP: zip, FIXTURE_GH_CALLS: calls};
    const report = {version: 1, market: 'korea', provider: 'auto_api_encar', completed: true,
      snapshotRun: '43812759975', snapshotAttempt: '1', completedAt: '2026-11-16T08:00:00Z',
      sources: [{sourceId: 'encar_direct', uniqueOffers: 1, stopReason: 'source_finished'}]};
    await exec('python3', ['-c', zipBuilder, zip, scenario, JSON.stringify(report)], {env, timeout: 10000});
    const digest = createHash('sha256').update(await fs.readFile(zip)).digest('hex');
    const binding = {runId: report.snapshotRun, currentAttempt: '2', snapshotAttempt: report.snapshotAttempt,
      artifactId: env.PREPARED_ENCAR_ARTIFACT_ID,
      artifactDigest: scenario === 'wrong-digest' ? (digest[0] === '0' ? '1' : '0') + digest.slice(1) : digest,
      repositoryId: '1072507081', headSha: '83ff17075e9188dcf227c8752dc064248d5f42e0'};
    await fs.writeFile(path.join(runner, 'paid-encar-artifact-binding.json'), JSON.stringify(binding));
    let result;
    try {
      result = {code: 0, ...await exec('bash', ['-c', await actualArchiveBlock()], {cwd, env, timeout: 15000, maxBuffer: 512 * 1024})};
    } catch (error) {
      assert.equal(error.killed, false, 'the archive verification must finish within its test deadline');
      result = {code: error.code, stdout: error.stdout, stderr: error.stderr};
    }
    const destination = path.join(cwd, 'catalog-intake-input/catalog-intake-korea');
    const downloaded = path.join(runner, 'paid-encar-intake.zip');
    await assert.rejects(fs.access(downloaded), error => error.code === 'ENOENT', 'the shell trap removes the downloaded archive');
    const recorded = (await fs.readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(recorded, [['api', `repos/${env.GITHUB_REPOSITORY}/actions/artifacts/${binding.artifactId}/zip`]]);
    if (scenario === 'valid') {
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(destination, 'report.json'), 'utf8')), report);
      assert.deepEqual((await fs.readdir(destination)).sort(), ['encar_direct-000001.jsonl', 'report.json']);
    } else if (scenario === 'wrong-digest') {
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /paid_encar_artifact_binding_archive_digest/);
      await assert.rejects(fs.access(destination), error => error.code === 'ENOENT', 'digest failure must stop before extraction begins');
    } else {
      assert.notEqual(result.code, 0);
      assert.match(result.stdout, /paid_encar_archive_digest_verified/, 'the malicious fixture has the correct archive digest');
      assert.match(result.stderr, /paid_encar_artifact_path_invalid/);
      assert.deepEqual(await fs.readdir(destination), [], 'all members must be checked before even the valid report is extracted');
      await assert.rejects(fs.access(path.join(cwd, 'catalog-intake-input/escaped.json')), error => error.code === 'ENOENT');
    }
  });
}
