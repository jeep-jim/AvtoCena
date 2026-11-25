import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base=process.cwd();
const source=relative=>fs.readFile(path.join(base,relative),'utf8');

test('Japan AJ source stays restricted to main/stats; no China/Korea fallback',async()=>{
 const p=await source('apps/web/lib/catalog/ajes-access-policy.ts');
 assert.match(p,/table\s*!==\s*'stats'\s*&&\s*table\s*!==\s*'main'/);
 assert.match(p,/market\s*!==\s*'japan'/);
 assert.match(p,/ajes-\(\?:china\|korea\)/);
});
test('AJ provider retains real visitor IP and bounded independent rate admission',async()=>{
 const [client,catalog,routing]=await Promise.all([
 source('apps/web/lib/catalog/ajes-client.ts'),
 source('apps/web/lib/catalog/ajes-catalog.ts'),
 source('apps/web/lib/catalog/ajes-routing.ts')
 ]);
 assert.match(client,/if\(!isIP\(clientIp\)\)/);
 assert.match(client,/concurrency:\s*2/);
 assert.match(client,/query\.kind!==['"]detail['"]/);
 assert.match(client,/readQuery/);
 assert.match(client,/reserve\(query\.table/);
 assert.match(catalog,/get\('x-real-ip'\)/);
 assert.match(routing,/isIP\(ip\)/);
});
test('AJ must never be represented as a complete locally downloaded Japan feed',async()=>{
 const [contract,market,cache,policy]=await Promise.all([
 source('docs/markets/contract.md'),
 source('docs/markets/japan.md'),
 source('apps/web/lib/catalog/ajes-query-cache.ts'),
 source('apps/web/lib/catalog/japan-year-policy.ts')
 ]);
 assert.match(contract,/полную выгрузку и зеркало/);
 assert.match(market,/Полный дамп, зеркало и массовый обход/);
 assert.match(cache,/previously requested responses/);
 assert.match(cache,/catalog\/partner-cache\/ajes\/queries/);
 assert.match(policy,/JAPAN_MIN_MODEL_YEAR\s*=\s*2008/);
});
test('Japan legacy publisher is not a dependency of accepted China daily feed',async()=>{
 const daily=await source('.github/workflows/catalog-next-china-daily.yml');
 assert.match(daily,/cron:\s*'0 14 \* \* \*'/);
 assert.doesNotMatch(daily,/ajes|japan|akebono|catalog-v2-japan/i);
 assert.doesNotMatch(daily,/build-release-image|docker\/setup-docker|catalog-publish-market/);
});
