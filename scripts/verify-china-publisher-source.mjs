import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {getJsonStorage} from '../apps/web/lib/data.ts';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected=process.env.CHINA_APPROVED_PUBLISHER_SHA;
assert.match(expected||'',/^[a-f0-9]{40}$/,'approved immutable publisher required');
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024}).trim();
assert.equal(git(['rev-parse','HEAD']),expected);
assert.equal(git(['diff','--name-only','HEAD']),'');
assert.equal(git(['ls-files','--others','--exclude-standard','--','scripts','apps/web/lib','packages']),'');
const response=await fetch('https://avtocena.com/api/health',{cache:'no-store',signal:AbortSignal.timeout(20000)});
assert.equal(response.ok,true);const health=await response.json();
assert.equal(health.ok,true);assert.equal(health.releaseSha,'696e0e71fd85b168b0725cb6bbf798db274e0b3d');
assert.equal(health.calculationVersion,'42956cba4305e206da7da20338db455790b0f6116899097caa753232d04c6d2f');
assert.equal(health.catalogProjectionParts,'scoped-v1');
const manifest=await getJsonStorage().readJson('catalog/manifest.json',null);
if (process.env.CATALOG_EXPECTED_BASE_GENERATION_ID || process.env.CATALOG_EXPECTED_BASE_MANIFEST_SHA256) {
  assert.equal(manifest?.generationId,process.env.CATALOG_EXPECTED_BASE_GENERATION_ID);
  assert.equal(hash(manifest),process.env.CATALOG_EXPECTED_BASE_MANIFEST_SHA256);
}
await fs.writeFile('china-source-preflight.json',JSON.stringify({publisher:expected,health,baselineGeneration:manifest.generationId,baselineSha256:hash(manifest),checkedAt:new Date().toISOString(),productionWrites:false},null,2));
