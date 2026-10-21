import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {auditChe168BulkSnapshot} from './lib/che168-bulk-audit.mjs';

// Read-only diagnosis of the exact failed run. No feed credential is needed;
// no provider endpoint, publication script or storage mutation is called.
const failureCodes=new Set([
  'auto_api_durable_storage_required','auto_api_bulk_audit_unexpected_snapshot',
  'auto_api_bulk_audit_already_published','auto_api_bulk_audit_missing_journal',
  'auto_api_bulk_audit_unexpected_journal_cursor','auto_api_bulk_audit_invalid_initial_cursor',
  'auto_api_bulk_audit_identity_review_required','auto_api_bulk_audit_invalid_event',
  'auto_api_bulk_audit_invalid_price','auto_api_bulk_audit_write_forbidden','auto_api_bulk_audit_unexpected_read',
  'auto_api_invalid_replay_checkpoint','auto_api_snapshot_incomplete',
  'auto_api_snapshot_part_corrupt','auto_api_invalid_csv','auto_api_invalid_csv_output',
]);
let report;
try{
  const config=JSON.parse(await fs.readFile('data/catalog/che168-snapshot-v1.json','utf8'));
  if(config.initialCursor!==11989266||config.date!=='2026-10-09'||config.bytes!==2893496089)throw Error('auto_api_bulk_audit_unexpected_snapshot');
  const storage=getJsonStorage();
  if(storage.driver!=='object')throw Error('auto_api_durable_storage_required');
  report=await auditChe168BulkSnapshot({config,storage,
    yearFrom:new Date(Date.now()+7*3600000).getUTCFullYear()-6,
    expectedCursor:11990320,expectedChanges:1054,
    onProgress:progress=>console.log(JSON.stringify(progress)),
  });
  report.sourceRunId='37907216966';
  report.auditCompleted=true;
}catch(error){
  // Whitelist fixed codes; never output upstream bodies, listing fields, URLs,
  // object credentials, arbitrary exception text or a stack containing them.
  report={version:1,readOnly:true,auditCompleted:false,sourceRunId:'37907216966',
    error:failureCodes.has(error?.message)?error.message:'auto_api_bulk_audit_failed'};
  process.exitCode=1;
}
await fs.writeFile('che168-bulk-audit-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
