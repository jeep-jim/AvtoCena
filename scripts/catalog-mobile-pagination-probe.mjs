import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MobileDeExactAdapter} from '../apps/web/lib/catalog/mobile-de-exact-source.ts';
const adapter=new MobileDeExactAdapter();
const report={checkedAt:new Date().toISOString(),productionWrites:false,pages:[]};
try {
 for(const page of [25,26]){
  const result=await adapter.fetchPage(JSON.stringify({shard:0,page}));
  report.pages.push({page,count:result.items.length,ids:result.items.map(row=>String(row.id)),nextCursor:result.nextCursor,health:result.health});
  assert.ok(result.items.length>0,`empty_page_${page}`);
  assert.deepEqual(JSON.parse(result.nextCursor),{shard:0,page:page+1});
 }
 const first=new Set(report.pages[0].ids);
 assert.ok(report.pages[1].ids.some(id=>!first.has(id)),'source_repeated_page');
 report.ok=true;
}catch(error){report.ok=false;report.error=String(error.message);process.exitCode=1;}
await fs.writeFile('europe-pagination-probe.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
