import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** CI's Python gate tests leave untracked bytecode under scripts. The real
 * producer correctly refuses that checkout. Exercise the committed worker in
 * its own clean source tree instead of relaxing its provenance contract. */
export async function che168CleanWorkerCheckout(t) {
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'che168-clean-worker-'));
  t.after(() => fs.rm(temporary, {recursive: true, force: true}));
  const root = path.join(temporary, 'worker');
  const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', timeout: 30000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const sourceSha = git(repository, 'rev-parse', '--verify', 'HEAD').trim();
  assert.match(sourceSha, /^[a-f0-9]{40}$/);
  // Local objects only; sparse checkout avoids copying the large data tree.
  // No worktree registration, remote fetch, new commit or source substitution.
  git(repository, 'clone', '--local', '--shared', '--no-checkout', '--quiet', '--', repository, root);
  git(root, 'sparse-checkout', 'set', '--no-cone', '/scripts/', '/apps/web/lib/', '/packages/',
    '/.gitignore', '/package.json', '/package-lock.json', '/tsconfig.json',
    '/apps/web/package.json', '/apps/web/tsconfig.json',
    '/data/catalog/power-reference/reported-power30-precedents.json',
    '/data/catalog/source-gallery-review-v1.json', '/data/catalog/research/public-quote-quarantine-20260916.json',
    '/data/catalog/korea-official-power/snapshot.json', '/data/catalog/refresh-policy-v1.json');
  git(root, 'checkout', '--detach', '--quiet', sourceSha);
  await fs.symlink(await fs.realpath(path.join(repository, 'node_modules')), path.join(root, 'node_modules'), 'dir');
  assert.equal(git(root, 'rev-parse', '--verify', 'HEAD').trim(), sourceSha);
  assert.equal(git(root, 'status', '--porcelain', '--untracked-files=normal').trim(), '');
  return {root, sourceSha};
}
