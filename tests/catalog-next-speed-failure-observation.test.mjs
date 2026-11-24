import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {checkedServerSpeedReport, ChinaSshSession} from '../scripts/catalog-next/release-ssh.mjs';

function evidence() {
  return {present: true, sha256: 'a'.repeat(64), exitCode: 1, rejectedSamples: 0, samples: [
    {performanceRequest: 'started', path: '/cars?market=china'},
    {performanceRequest: 'complete', path: '/cars?market=china', seconds: 0.04, functionalPassed: true},
    {performanceRequest: 'failed', path: '/cars?market=china', seconds: 90, errorType: 'TimeoutError'},
    {speedBaseline: 'warm', path: '/cars?market=china', referenceSeconds: 0.09, measurementNoiseSeconds: 0.05,
      ceilingSeconds: 0.14, seconds: 0.2, blocking: true, passed: false, recheckSeconds: [0.18, 0.19, 0.17], recheckMedianSeconds: 0.18},
    {performanceGate: 'after_ttl', path: '/cars?market=china', seconds: 0.04, ceiling: 0.2,
      passed: true, functionalPassed: true, latencyBlocking: false},
    {performanceGate: 'summary', marketScope: 'china', routes: ['/cars?market=china'], acceptedBaselineRoutes: ['/cars?market=china'],
      samples: 3, slowSamples: 1, functionalPassed: true, performanceAccepted: false, latencyBlocking: true, acceptedBaselineEnforced: true},
  ]};
}

test('bounded speed evidence retains failure samples, baseline/retries and all frozen public paths', async () => {
  const source = evidence(), result = checkedServerSpeedReport(source);
  assert.deepEqual(result, source); assert.notEqual(result, source); assert.notEqual(result.samples, source.samples);
  const baseline = JSON.parse(await fs.readFile(new URL('../docs/operations/2026-11-11-accepted-speed-baseline.json', import.meta.url)));
  for (const path of new Set([...baseline.samples.map(row => row.path), '/cars?market=china'])) {
    assert.doesNotThrow(() => checkedServerSpeedReport({...evidence(), samples: [{performanceRequest: 'started', path}]}));
  }
  assert.deepEqual(checkedServerSpeedReport({present: false, sha256: null, exitCode: null, samples: [], rejectedSamples: 0}),
    {present: false, sha256: null, exitCode: null, samples: [], rejectedSamples: 0});
});

test('private/unknown fields and paths never cross the speed evidence boundary', () => {
  for (const mutation of [value => { value.stderr = 'PRIVATE'; }, value => { value.samples[2].body = 'PRIVATE'; },
    value => { value.samples[2].errorType = 'PRIVATE_EXCEPTION'; }, value => { value.samples[0].path = '/cars?token=SECRET'; },
    value => { value.samples[3].speedBaseline = 'unreviewed'; }, value => { value.samples[5].routes.push('/private'); },
    value => { value.samples[5].marketScope = 'all'; }, value => { value.samples[5].samples = 10001; }]) {
    const value = evidence(); mutation(value);
    assert.throws(() => checkedServerSpeedReport(value), /china_ssh_server_speed_report/);
  }
});

test('invalid metrics and bounds are rejected including nonfinite or nonnumeric retries', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, 86401, true, '0.2', null]) {
    for (const field of ['seconds', 'referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'recheckMedianSeconds']) {
      const value = evidence(); value.samples[3][field] = invalid;
      assert.throws(() => checkedServerSpeedReport(value), /china_ssh_server_speed_report/);
    }
    const value = evidence(); value.samples[3].recheckSeconds[0] = invalid;
    assert.throws(() => checkedServerSpeedReport(value), /china_ssh_server_speed_report/);
  }
  for (const changed of [{exitCode: 256}, {exitCode: 1.5}, {rejectedSamples: -1}, {rejectedSamples: 512},
    {present: false}, {samples: Array(513).fill(evidence().samples[0])}, {sha256: 'SECRET'}]) {
    assert.throws(() => checkedServerSpeedReport({...evidence(), ...changed}), /china_ssh_server_speed_report/);
  }
});

function session(t, serverSpeed) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({write(raw, _encoding, callback) {
    const request = JSON.parse(raw); callback();
    queueMicrotask(() => child.stdout.write(JSON.stringify({kind: 'error', id: request.id,
      code: 'china_host_server_speed_failed', serverSpeed}) + '\n'));
  }});
  child.kill = () => { queueMicrotask(() => child.emit('close', 255, null)); return true; };
  const client = new ChinaSshSession(child); t.after(() => client.abort()); return client;
}

test('SSH attaches sanitized speed evidence to the original failed gate', async t => {
  const value = evidence(), client = session(t, value);
  await assert.rejects(client.call('speed'), error => {
    assert.equal(error.message, 'china_host_server_speed_failed'); assert.deepEqual(error.serverSpeed, value); return true;
  });
  assert.equal(client.pending.size, 0);
});

test('malformed optional evidence is omitted without masking the original failure or leaving a pending request', async t => {
  for (const malformed of [{...evidence(), stderr: 'PRIVATE'}, {...evidence(), samples: [{performanceRequest: 'failed',
    path: '/cars?market=china', seconds: null, errorType: 'TimeoutError'}]}]) {
    const client = session(t, malformed);
    await assert.rejects(client.call('speed'), error => {
      assert.equal(error.message, 'china_host_server_speed_failed'); assert.equal(error.serverSpeed, undefined); return true;
    });
    assert.equal(client.pending.size, 0);
  }
});
