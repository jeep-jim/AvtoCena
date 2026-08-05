import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const syncWorkflow = fs.readFileSync('.github/workflows/vehicle-knowledge-sync.yml', 'utf8');
const backfillWorkflow = fs.readFileSync('.github/workflows/vehicle-knowledge-backfill-2011.yml', 'utf8');

for (const [name, workflow] of [['sync', syncWorkflow], ['backfill', backfillWorkflow]]) {
  test(`${name} stores stable vehicle knowledge in GitHub from 2011 onward`, () => {
    assert.match(workflow, /JSON_STORAGE_DRIVER:\s*file/);
    assert.match(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*2011/);
    assert.match(workflow, /DROM_KNOWLEDGE_ONLY_RECENT:\s*0/);
    assert.match(workflow, /data\/catalog\/vehicle-knowledge/);
    assert.doesNotMatch(workflow, /JSON_STORAGE_DRIVER:\s*object/);
    assert.doesNotMatch(workflow, /YC_OBJECT_STORAGE_BUCKET/);
  });
}

test('full backfill processes saved-progress batches and the complete 2011-2015 tail', () => {
  assert.match(backfillWorkflow, /DROM_KNOWLEDGE_LIMIT:\s*1000/);
  assert.match(backfillWorkflow, /DROM_KNOWLEDGE_BATCHES:\s*4/);
  assert.match(backfillWorkflow, /cancel-in-progress:\s*false/);
  assert.match(backfillWorkflow, /progress is saved/);
  assert.doesNotMatch(backfillWorkflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*(?:19|200\d|2010)\b/);
});

test('pull request validation uses a small ten-model smoke batch', () => {
  assert.match(syncWorkflow, /github\.event_name == 'pull_request' && '10'/);
});
