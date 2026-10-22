import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getJsonStorage} from '../apps/web/lib/data.ts';

// Read only: keep supplier checkpoints, publication and writer locks untouched.
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('durable_object_storage_required');
const report={checkedAt:new Date().toISOString(),references:{}};
const exec=promisify(execFile);
function errorCategory(message){return String(message||'').match(/HTTP Error \d{3}|http[_ :]*\d{3}|timed out|timeout|robots_disallow|no_catalog_content_or_access_challenge|redirect_outside_catalog|page_too_large|unsupported_reference_url|captcha|access denied|ENOTFOUND|ECONNRESET|UnicodeDecodeError/i)?.[0]||'unclassified';}
for(const [name,root] of [['technical','reference-intake'],['comparison','comparison-intake']]){
 const state=await storage.readJson(`knowledge/encyclopedia/${root}/v1/state.json`,null);
 report.references[name]=state?{
  visited:state.visited?.length,saved:state.saved,pending:state.pending?.length,
  completed:state.completed===true,updatedAt:state.updatedAt,
  // Only known error categories: do not publish supplier responses or URLs.
  failures:(state.failed||[]).slice(-5).map(row=>({at:row.at,
   category:errorCategory(row.message),
   digest:(String(row.message||'').includes('SyntaxError')?'parser_syntax':undefined)}))
 }: {missing:true};
 if(process.env.REFERENCE_DIAGNOSE_ONE==='1'&&state?.pending?.length){
  // One saved URL only, with the existing robots/redirect/access checks.
  // No crawl, checkpoint mutation, retries or challenge bypass.
  const parser=name==='comparison'?'read-comparison-reference.py':'read-technical-reference.py';
  let stdout,executionError;
  try{({stdout}=await exec('python3',[`scripts/encyclopedia/${parser}`,state.pending[0]],{timeout:65000,maxBuffer:4000000}));}
  catch(error){stdout=error.stdout;executionError=error;}
  let row;try{row=JSON.parse(stdout||'null');}catch{}
  report.references[name].singlePageProbe=row&&!row.error?{ok:true,factualFields:Object.keys(row.facts||{}).length,links:row.links?.length}:{ok:false,category:errorCategory(row?.detail||executionError?.message),errorType:/^[A-Za-z]+Error$/.test(row?.error||'')?row.error:undefined};
 }
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
