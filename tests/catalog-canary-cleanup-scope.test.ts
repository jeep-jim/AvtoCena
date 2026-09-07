import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('canary cleanup verifies all reports before deletion and only removes its recorded copies', async () => {
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const originalExit = process.exitCode;
  const env = { ...process.env };
  const planPath = 'data/catalog/research/canary-image-copy-removal-plan-v1-20260907.json';
  const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
  const script = new URL('../scripts/catalog-remove-canary-image-copies.mjs', import.meta.url);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'canary-cleanup-'));
  await fs.mkdir(path.join(temp, path.dirname(planPath)), { recursive: true });
  await fs.writeFile(path.join(temp, planPath), JSON.stringify(plan));
  Object.assign(process.env, { YC_OBJECT_STORAGE_ENDPOINT: 'https://storage.example', YC_OBJECT_STORAGE_BUCKET: 'test-bucket',
    YC_OBJECT_STORAGE_PREFIX: 'test', YC_OBJECT_STORAGE_REGION: 'ru-central1', YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test',
    YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test', GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_TOKEN: 'test' });
  process.chdir(temp);
  try {
    for (const invalidReport of [true, false]) {
      const present = new Set<string>(plan.runs.flatMap((run: any) => run.files.map((file: any) => file.key)));
      const originalKeys = new Set(present);
      const deleted: string[] = [];
      const artifacts = new Map([[10001391217, 34073795968], [10001412782, 34073795968], [10001519426, 34074192666]]);
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(String(input));
        const method = String(init.method || 'GET');
        if (url.origin === 'https://api.github.com') {
          const id = Number(url.pathname.split('/').pop());
          assert.match(url.pathname, /^\/repos\/jeep-jim\/AvtoCena\/actions\/artifacts\/\d+$/);
          if (!artifacts.has(id)) return new Response(null, { status: 404 });
          if (method === 'DELETE') { artifacts.delete(id); return new Response(null, { status: 204 }); }
          return Response.json({ id, workflow_run: { id: artifacts.get(id) }, name: 'generation-canary-europe' });
        }
        assert.equal(url.origin, 'https://storage.example');
        const key = decodeURIComponent(url.pathname).replace(/^\/test-bucket\/test\//, '');
        if (method === 'GET') {
          const run = plan.runs.find((row: any) => row.reportKey === key);
          assert.ok(run, 'GET must never download image bytes');
          return Response.json({ accepted: !invalidReport, runId: run.runId, market: run.market, codeSha: run.codeSha, files: run.files });
        }
        assert.ok(originalKeys.has(key), 'HEAD/DELETE must never target live or unrecorded keys');
        if (method === 'HEAD') return new Response(null, { status: present.has(key) ? 200 : 404 });
        assert.equal(method, 'DELETE');
        deleted.push(key); present.delete(key);
        return new Response(null, { status: 204 });
      };
      await import(`${script.href}?invalidReport=${invalidReport}`);
      const result = JSON.parse(await fs.readFile('canary-image-copy-removal-report.json', 'utf8'));
      assert.equal(result.completed, !invalidReport);
      assert.equal(deleted.length, invalidReport ? 0 : 148);
      if (invalidReport) assert.equal(result.error, 'cleanup_saved_report_mismatch');
      else { assert.equal(result.verifiedAbsent, 148); assert.equal(result.artifactsRemoved.length, 3); }
      process.exitCode = originalExit;
    }
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd); process.exitCode = originalExit;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
