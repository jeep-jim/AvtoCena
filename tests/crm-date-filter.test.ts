import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterLeads,leadDateKey} from '../apps/web/lib/crm-visibility';
const manager:any={id:'m',role:'manager',status:'active'};
test('date filter matches displayed Novokuznetsk day and keeps access/archive filters',()=>{
 const rows=[
  {id:'before',createdAt:'2026-09-23T16:59:59Z',assignedManagerId:'m'},
  {id:'start',createdAt:'2026-09-23T17:00:00Z',assignedManagerId:'m'},
  {id:'end',createdAt:'2026-09-24T16:59:59Z',assignedManagerId:'m'},
  {id:'next',createdAt:'2026-09-24T17:00:00Z',assignedManagerId:'m'},
  {id:'hidden',createdAt:'2026-09-24T10:00:00Z',assignedManagerId:'other'},
  {id:'archive',createdAt:'2026-09-24T10:00:00Z',assignedManagerId:'m',archivedAt:'yes'},
 ];
 assert.deepEqual(filterLeads(rows,manager,{date:'2026-09-24'}).map(x=>x.id),['start','end']);
 assert.deepEqual(filterLeads(rows,manager,{date:'2026-09-24',view:'archive'}).map(x=>x.id),['archive']);
 assert.equal(leadDateKey('bad'),'');
 assert.equal(filterLeads(rows,null,{date:'2026-09-24'}).length,0);
});
