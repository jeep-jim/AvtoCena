import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('China workflow enables bounded scoped writes without enabling other markets',()=>{
 const yml=fs.readFileSync('.github/workflows/catalog-market-refresh.yml','utf8');
 assert.match(yml,/CATALOG_CHUNKED_PROJECTIONS_WRITE: \$\{\{ matrix.market == 'china' && '1' \|\| '0' \}\}/);
});
test('publisher verifies scoped reader before intake and again at commit',()=>{
 const code=fs.readFileSync('scripts/catalog-publish-market.mjs','utf8');
 const check="await assertScopedProjectionReaderReady()";
 assert.ok(code.indexOf(check)>0 && code.indexOf(check)<code.indexOf('const generation = await readGenerationFiles()'));
 const commit=code.slice(code.indexOf('async beforeManifestCommit() {'));
 assert.ok(commit.indexOf(check)>=0 && commit.indexOf(check)<commit.indexOf('await technicalRepairGuard'));
});
