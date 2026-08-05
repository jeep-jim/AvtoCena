import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/vehicle-knowledge-sync.yml', 'utf8');
const enrichment = fs.readFileSync('scripts/catalog-enrich-drom-vehicle-variants.mjs', 'utf8');
const brandDirectory = fs.readFileSync('apps/web/components/catalog/BrandModelDirectory.tsx', 'utf8');
const modelPage = fs.readFileSync('apps/web/app/cars/brand/[slug]/model/[model]/page.tsx', 'utf8');

test('production knowledge uses the 2011+ import window and meaningful batches', () => {
  assert.match(workflow, /VEHICLE_KNOWLEDGE_MIN_MODEL_YEAR:\s*2011/);
  assert.match(workflow, /DROM_KNOWLEDGE_LIMIT:\s*1000/);
  assert.match(workflow, /DROM_KNOWLEDGE_BATCHES:\s*4/);
  assert.match(enrichment, /new Date\(\)\.getFullYear\(\) - RECENT_YEARS/);
});

test('public model pages do not expose internal empty knowledge diagnostics', () => {
  for (const forbidden of [
    'Характеристики собираются',
    'стоит в очереди базы знаний',
    'Автосопоставление включено',
    'Записей в базе',
    'поколения уточняются',
  ]) {
    assert.equal(brandDirectory.includes(forbidden) || modelPage.includes(forbidden), false, forbidden);
  }
});
