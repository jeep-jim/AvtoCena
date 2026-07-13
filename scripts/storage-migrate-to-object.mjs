import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.JSON_STORAGE_DRIVER = 'object';
const root = process.cwd();
const dataRoot = join(root, 'data');
const dryRun = process.argv.includes('--dry-run');
const collections = ['clients/clients.json','leads/leads.json','activity/feed.json','deals/deals.json','partners/partners.json','partners/accruals.json','cpa/networks.json','cpa/payouts.json'];
const { ObjectJsonStorage } = await import(pathToFileURL(join(root, 'apps/web/lib/data.ts')).href).catch(async () => import('../apps/web/lib/data.ts'));
const storage = new ObjectJsonStorage();
function safeJson(path, fallback){ try { return JSON.parse(readFileSync(path,'utf8')); } catch { return fallback; } }
function filesFor(collection){ const dir=join(dataRoot, collection.split('/').slice(0,-1).join('/')); const base=collection.split('/').pop(); const [name, ext]=base.split(/(?=\.json$)/); return readdirSync(dir).filter(f => f===base || f===`${name}-index.json` || (f.startsWith(`${name}-`) && f.endsWith('.json'))).map(f=>join(dir,f)); }
const report=[];
for (const collection of collections) {
  const files = filesFor(collection);
  let records = 0;
  for (const file of files) {
    const rel = relative(dataRoot, file).replaceAll('\\','/');
    const json = safeJson(file, []);
    if (Array.isArray(json) && !rel.includes('-index.json')) records += json.length;
    if (!dryRun) await storage.writeJson(rel, json);
  }
  report.push({ collection, files: files.length, records });
}
console.log(JSON.stringify({ ok:true, dryRun, driver:'object', bucket: process.env.YC_OBJECT_STORAGE_BUCKET || '(not set)', prefix: process.env.YC_OBJECT_STORAGE_PREFIX || '', report }, null, 2));
