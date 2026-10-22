import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';

// Read only: keep supplier checkpoints, publication and writer locks untouched.
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('durable_object_storage_required');
const report={checkedAt:new Date().toISOString(),references:{}};
for(const [name,root] of [['technical','reference-intake'],['comparison','comparison-intake']]){
 const state=await storage.readJson(`knowledge/encyclopedia/${root}/v1/state.json`,null);
 report.references[name]=state?{
  visited:state.visited?.length,saved:state.saved,pending:state.pending?.length,
  completed:state.completed===true,updatedAt:state.updatedAt,
  // Only known error categories: do not publish supplier responses or URLs.
  failures:(state.failed||[]).slice(-5).map(row=>({at:row.at,
   category:String(row.message||'').match(/HTTP Error \d{3}|http[_ :]*\d{3}|timed out|timeout|captcha|robot|access denied|ENOTFOUND|ECONNRESET|empty[^\s]{0,40}/i)?.[0]||'unclassified',
   digest:(String(row.message||'').includes('SyntaxError')?'parser_syntax':undefined)}))
 }: {missing:true};
}
const before=await storage.readJson('catalog/manifest.json',null);
const projection=await storage.readJson('catalog/public/projection/china.json',null);
const checkpoint=await storage.readJson('catalog/intake-cursors/v1/china.json',null);
const after=await storage.readJson('catalog/manifest.json',null);
const years={};
for(const row of projection?.items||[])years[row.year]=(years[row.year]||0)+1;
report.china={generationId:before?.generationId,projectionGeneration:projection?.generationId,
 stableGeneration:before?.generationId===after?.generationId,
 counts:Object.fromEntries(Object.entries(before?.markets||{}).map(([key,value])=>[key,value.count])),
 projectionCount:projection?.items?.length,years,checkpointGeneration:checkpoint?.generationId,
 sources:(checkpoint?.sources||[]).map(row=>({sourceId:row.sourceId,provider:row.provider,cursor:row.cursor,stopReason:row.stopReason}))};
await fs.writeFile('catalog-recovery-status.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(!report.china.stableGeneration||before?.generationId!==projection?.generationId)throw Error('publication_changed_during_read');
