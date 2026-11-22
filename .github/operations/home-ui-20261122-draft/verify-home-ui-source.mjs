// Draft controller component: read-only verification of a committed home-only
// candidate. This file does not build, deploy, publish data or contact a host.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const BASE = '22867cbcfaee27b2e8917b6bf880e44827f67b60';
const SOURCE_CALCULATION = '672958a80c6a6eb869798c93cf1ee7d88301286ac910163115320fe5d8b95761';
const [root, appSha, expectedDiffSha] = process.argv.slice(2);
assert.equal(process.argv.length, 5, 'usage: node verify-home-ui-source.mjs <checkout> <exact-app-sha> <exact-binary-diff-sha256>');
assert.ok(path.isAbsolute(root));
assert.match(appSha, /^[a-f0-9]{40}$/);
assert.match(expectedDiffSha, /^[a-f0-9]{64}$/);
assert.notEqual(appSha, BASE);
const git = (...args) => execFileSync('git', args, {cwd: root, maxBuffer: 32 * 1024 * 1024});
assert.equal(git('rev-parse', 'HEAD').toString().trim(), appSha, 'exact checkout');
assert.equal(git('show', '-s', '--format=%P', 'HEAD').toString().trim(), BASE, 'exact live parent');
assert.equal(git('status', '--porcelain=v1', '--untracked-files=normal').toString(), '', 'clean checkout');

const allowed = new Set([
  'apps/web/app/(public)/page.tsx',
  'apps/web/app/api/catalog/home/route.ts',
  'apps/web/app/_lib/home-card-payload.ts',
  'tests/home-card-payload.test.ts',
  'tests/home-initial-catalog.test.ts',
  'tests/home-rendering.test.ts',
  'AGENTS.md', 'roadmap.md', '.rgignore',
  'docs/roadmap/README.md', 'docs/roadmap/current-task.md',
  'docs/roadmap/feeds.md', 'docs/roadmap/performance.md',
  'docs/roadmap/source-policy.md', 'docs/roadmap/log/2026-11-22.md',
]);
const changed = git('diff', '--name-only', '-z', BASE, appSha, '--').toString().split('\0').filter(Boolean);
assert.ok(changed.length > 0);
for (const name of changed) assert.ok(allowed.has(name), 'unexpected changed path: ' + name);
for (const name of [
  'apps/web/app/(public)/page.tsx',
  'apps/web/app/api/catalog/home/route.ts',
  'apps/web/app/_lib/home-card-payload.ts',
  'tests/home-card-payload.test.ts', 'tests/home-rendering.test.ts',
]) assert.ok(changed.includes(name), 'missing reviewed home change: ' + name);

const diff = git('--no-pager', 'diff', '--no-ext-diff', '--no-renames', '--no-textconv', '--binary', '--full-index', BASE, appSha, '--');
assert.equal(createHash('sha256').update(diff).digest('hex'), expectedDiffSha, 'reviewed complete diff');
// Match the existing source-closure policy; never weaken that policy to retain
// a namespace. Equality is checked before importing the unmodified calculator.
const closure = ref => git('ls-tree', '-rz', '--full-tree', ref).toString().split('\0').filter(Boolean).filter(record => {
  const name = record.slice(record.indexOf('\t') + 1);
  return /^(?:apps\/web\/lib\/|packages\/|data\/|scripts\/)/.test(name)
    || /^(?:package(?:-lock)?\.json|Dockerfile|tsconfig[^/]*\.json|apps\/web\/(?:package\.json|tsconfig[^/]*\.json|next\.config\.[^/]+)|\.github\/workflows\/deploy-yandex\.yml)$/.test(name);
});
const baseline = closure(BASE), candidate = closure(appSha);
assert.deepEqual(candidate, baseline, 'unchanged complete calculation source closure');
const {calculationVersion} = await import(pathToFileURL(path.join(root, 'scripts/catalog-calculation-version.mjs')).href);
assert.equal(calculationVersion(root), SOURCE_CALCULATION, 'existing calculation script result');
console.log(JSON.stringify({version: 1, kind: 'home-ui-only-source-proof', base: BASE,
  appSha, diffSha256: expectedDiffSha, sourceCalculationVersion: SOURCE_CALCULATION,
  identicalCalculationRecords: candidate.length, changedPaths: changed.length}));
