import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(".github/workflows/catalog-republish-market-artifacts.yml", "utf8");

test('full rebuild collects one market at a time without reducing source capacity or cancelling active runs', () => {
 const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
 const collect = source.slice(source.indexOf('\n  collect:'), source.indexOf('\n  publish:'));
 assert.match(collect, /max-parallel: 1\b/);
 assert.doesNotMatch(collect, /max-parallel: [2-9]/);
 assert.match(source, /group: catalog-six-market-quality-rebuild\n  cancel-in-progress: false/);
 assert.match(source, /CATALOG_REBUILD_TARGET_PER_SOURCE: '100000'/);
 assert.match(source, /CATALOG_PUBLISH_MAX_PER_MARKET: '100000'/);
 assert.match(collect, /timeout-minutes: 240/);
});

test('scheduled default plan starts with China and preserves all five markets', () => {
 const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
 const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-sequential-plan-'));
 try {
  const output = path.join(directory, 'output');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
   cwd: directory, env: {...process.env, EVENT_NAME: 'schedule', GITHUB_OUTPUT: output}, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(output, 'utf8'), /^collect_markets=\["china","korea","uae","georgia","europe"\]$/m);
 } finally { fs.rmSync(directory, {recursive: true, force: true}); }
});

test('five-market push reads its own reuse marker instead of starting another crawl', () => {
  const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
  const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
  assert.match(script, /EVENT_NAME === 'push'/);
  assert.match(script, /readFileSync\('\.github\/market-runs\/five-market-full-rebuild\.json'/);
  assert.doesNotMatch(script, /weekly-six-market-catalog/);
  assert.match(source, /run-id: \$\{\{ needs\.plan\.outputs\.reuse_run_id \}\}/);
  assert.match(source, /const allowed = \['china','korea','uae','georgia','europe'\]/);
  assert.match(source, /fromJSON\(needs\.plan\.outputs\.collect_markets\)/);
});

test('a targeted UAE repair collects and publishes only UAE and rejects Japan', () => {
  const source = fs.readFileSync('.github/workflows/catalog-five-market-full-rebuild.yml', 'utf8');
  const script = source.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n\s+JS/)![1];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-plan-test-'));
  try {
    const markers = path.join(directory, '.github/market-runs');
    fs.mkdirSync(markers, { recursive: true });
    const marker = path.join(markers, 'five-market-full-rebuild.json');
    const output = path.join(directory, 'output');
    fs.writeFileSync(marker, JSON.stringify({ publishMarkets: ['uae'] }));
    const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory, env: { ...process.env, EVENT_NAME: 'push', GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    assert.equal(run().status, 0);
    const values = fs.readFileSync(output, 'utf8');
    assert.match(values, /^publish_markets=uae$/m);
    assert.match(values, /^collect_markets=\["uae"\]$/m);
    fs.writeFileSync(marker, JSON.stringify({ publishMarkets: ['japan'] }));
    assert.notEqual(run().status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("collected market artifacts can be republished without another source crawl", () => {
  assert.match(workflow, /\.github\/market-runs\/republish-artifacts/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
  assert.match(workflow, /run-id: \$\{\{ needs\.config\.outputs\.run_id \}\}/);
  assert.match(workflow, /pattern: catalog-v3-\$\{\{ needs\.config\.outputs\.market \}\}-\[0-4\]/);
  assert.match(workflow, /files\.length!==5\|\|total<=0/);
  assert.match(workflow, /npx tsx scripts\/catalog-publish-market\.mjs/);
  assert.match(workflow, /npx tsx scripts\/catalog-live-postpersist-audit\.mjs/);
  assert.doesNotMatch(workflow, /catalog-rebuild-source-shard\.mjs/);
  assert.match(workflow, /market === 'japan' \? '2592000000' : '1209600000'/);
  assert.match(workflow, /timeout-minutes: 120/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_TTL_MS: "1800000"/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_HEARTBEAT_MS: "300000"/);
});
