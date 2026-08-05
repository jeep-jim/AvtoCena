import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/vehicle-knowledge-backfill-2011.yml', 'utf8');

test('production knowledge backfill covers every catalog model from 2011 onward', () => {
  assert.match(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*2011/);
  assert.match(workflow, /DROM_KNOWLEDGE_ONLY_RECENT:\s*0/);
  assert.match(workflow, /DROM_KNOWLEDGE_LIMIT:\s*1000/);
  assert.match(workflow, /DROM_KNOWLEDGE_BATCHES:\s*4/);
  assert.match(workflow, /catalog:sync-vehicle-models/);
  assert.match(workflow, /catalog:enrich-drom-variants/);
  assert.match(workflow, /catalog:build-vehicle-variants/);
});

test('backfill persists progress and does not restart or skip the 2011-2015 tail', () => {
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /progress is saved/);
  assert.doesNotMatch(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*(?:19|200\d|2010)\b/);
});

test('stable knowledge is committed to GitHub and does not consume Object Storage quota', () => {
  assert.match(workflow, /JSON_STORAGE_DRIVER:\s*file/);
  assert.match(workflow, /permissions:[\s\S]*contents:\s*write/);
  assert.match(workflow, /git add data\/catalog\/vehicle-knowledge data\/catalog\/power-knowledge data\/catalog\/power-reference data\/models/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /YC_OBJECT_STORAGE_BUCKET/);
  assert.doesNotMatch(workflow, /catalog:reindex-vehicle-knowledge/);
});
