import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/vehicle-knowledge-backfill-2011.yml', 'utf8');

test('production knowledge backfill covers every catalog model from 2011 onward in checkpointed batches', () => {
  assert.match(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*2011/);
  assert.match(workflow, /DROM_KNOWLEDGE_ONLY_RECENT:\s*0/);
  assert.match(workflow, /DROM_KNOWLEDGE_LIMIT:\s*(?:[1-9]\d?|1\d\d|200)/);
  assert.match(workflow, /Enrich one checkpointed priority batch/);
  assert.match(workflow, /catalog:sync-vehicle-models/);
  assert.match(workflow, /catalog:enrich-drom-variants/);
  assert.match(workflow, /catalog:build-vehicle-variants/);
});

test('backfill persists progress and does not restart or skip the 2011-2015 tail', () => {
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /Commit checkpointed vehicle knowledge to GitHub/);
  assert.match(workflow, /git commit -m "data: checkpoint vehicle knowledge 2011\+"/);
  assert.doesNotMatch(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*(?:19|200\d|2010)\b/);
});

test('stable vehicle knowledge is versioned in GitHub while production offers are read from Object Storage', () => {
  assert.match(workflow, /JSON_STORAGE_DRIVER:\s*file/);
  assert.match(workflow, /contents:\s*write/);
  assert.match(workflow, /Hydrate verified production offers from Object Storage/);
  assert.match(workflow, /git add data\/catalog\/vehicle-knowledge data\/catalog\/power-knowledge data\/catalog\/power-reference data\/models/);
  assert.doesNotMatch(workflow, /JSON_STORAGE_DRIVER:\s*object/);
});
