import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.JSON_STORAGE_DRIVER = 'object';
const root = process.cwd();
const dataRoot = join(root, 'data');
const dryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const allCollections = ['clients/clients.json','leads/leads.json','activity/feed.json','deals/deals.json','partners/partners.json','partners/accruals.json','cpa/networks.json','cpa/payouts.json','markets/markets.json','settings/site-business.json','settings/change-log.json','contracts/templates.json'];
const collections = onlyArg ? allCollections.filter((item) => item === onlyArg.slice('--only='.length)) : allCollections;
const { ObjectJsonStorage } = await import(pathToFileURL(join(root, 'apps/web/lib/data.ts')).href).catch(async () => import('../apps/web/lib/data.ts'));
const storage = dryRun ? null : new ObjectJsonStorage();
function safeJson(filePath, fallback){ try { return JSON.parse(readFileSync(filePath,'utf8')); } catch (error) { return fallback; } }
function countRecords(value){ return Array.isArray(value) ? value.length : (value && typeof value === 'object' && Array.isArray(value.versions) ? value.versions.length : 1); }
function filesFor(collection){
  const dir=join(dataRoot, collection.split('/').slice(0,-1).join('/'));
  const base=collection.split('/').pop();
  if (!existsSync(dir)) return { files: [], skipped: 'not_found' };
  const name=base.replace(/\.json$/, '');
  const files = readdirSync(dir).filter((file) => file===base || file===`${name}-index.json` || (file.startsWith(`${name}-`) && file.endsWith('.json'))).map((file)=>join(dir,file));
  return { files, skipped: files.length ? null : 'not_found' };
}
const report=[];
for (const collection of collections) {
  const { files, skipped } = filesFor(collection);
  const item = { collection, files: files.length, records: 0, skipped, errors: [] };
  for (const file of files) {
    const rel = relative(dataRoot, file).replaceAll('\\','/');
    const json = safeJson(file, null);
    if (json === null) { item.errors.push({ file: rel, error: 'invalid_json' }); continue; }
    if (!rel.includes('-index.json')) item.records += countRecords(json);
    if (!dryRun) {
      try {
        await storage.writeJson(rel, json);
        const uploaded = await storage.readJson(rel, null);
        if (JSON.stringify(uploaded) !== JSON.stringify(json)) item.errors.push({ file: rel, error: 'verify_failed' });
      } catch (error) {
        item.errors.push({ file: rel, error: error instanceof Error ? error.message : 'upload_failed' });
      }
    }
  }
  report.push(item);
}
console.log(JSON.stringify({ ok: report.every((item) => item.errors.length === 0), dryRun, driver:'object', bucketConfigured: Boolean(process.env.YC_OBJECT_STORAGE_BUCKET), prefix: process.env.YC_OBJECT_STORAGE_PREFIX || '', report }, null, 2));
if (report.some((item) => item.errors.length)) process.exitCode = 1;
