import test from 'node:test';import assert from 'node:assert/strict';
import {gptReleaseReport} from '../apps/web/lib/crm-gpt-report';
import {LEAD_STATUSES} from '../apps/web/lib/crm';
import {LEAD_COLUMNS,leadColumn} from '../apps/web/lib/crm-lead-board';
test('release reports are idempotent, use GPT identity and preserve team comments and progress',()=>{
 const rows:any=[{id:'idea',number:12,progress:4,comments:[{id:'human',text:'Original'}]}];const report={number:12,text:'Обновление установлено'};const updated=gptReleaseReport(rows,report,'a'.repeat(40),'2026-10-12T08:00:00Z');
 assert.equal(updated[0].progress,4);assert.equal(updated[0].comments?.length,2);assert.equal(updated[0].comments?.[1].authorId,'service_gpt');assert.deepEqual(gptReleaseReport(updated,report,'a'.repeat(40),'later'),updated);assert.equal(rows[0].comments.length,1);
 assert.throws(()=>gptReleaseReport(rows,{...report,number:13},'a'.repeat(40),'now'),/missing/);assert.throws(()=>gptReleaseReport(rows,report,'invalid','now'),/invalid/);
});
test('every existing status has exactly one board column, including deferred demand',()=>{for(const status of LEAD_STATUSES)assert.equal(LEAD_COLUMNS.filter(c=>c.statuses.includes(status)).length,1);assert.equal(leadColumn('deferred'),'deferred');});
