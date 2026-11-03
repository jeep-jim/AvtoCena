import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pendingDealerApprovals} from '../apps/web/lib/dealers/pending-approvals';
import {EMPTY_MEMBERSHIP} from '../apps/web/lib/dealers/program-model';
test('pending approvals include existing submissions, stay owner-only and disappear after approval',async()=>{
 const cwd=process.cwd(),old=process.env.JSON_STORAGE_DRIVER,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pending-dealers-'));
 process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 const write=(p:string,v:unknown)=>{fs.mkdirSync(path.dirname('data/'+p),{recursive:true});fs.writeFileSync('data/'+p,JSON.stringify(v));};
 const owner={id:'owner',role:'owner',companyId:'dealer_topavto',status:'active'} as any;
 const agreement={submittedAt:'2026-11-03T10:00:00Z',representative:'Representative'};
 try{
  write('dealers/dealers.json',[{id:'first',name:'First'},{id:'second',name:'Second'},{id:'empty',name:'Empty'}]);
  write('dealers/memberships/first.json',{...EMPTY_MEMBERSHIP,agreement});
  write('dealers/memberships/second.json',{...EMPTY_MEMBERSHIP,agreement:{...agreement,submittedAt:'2026-11-03T11:00:00Z'}});
  for(const actor of [{...owner,role:'admin'},{...owner,role:'dealer'}, {...owner,companyId:'first'},{...owner,status:'disabled'}])assert.deepEqual(await pendingDealerApprovals(actor),[]);
  const rows=await pendingDealerApprovals(owner);assert.equal(rows.length,2);assert.equal(rows[0].dealerId,'second');assert.equal(rows[0].href,'/crm/dealers/second#dealer-approval');assert.equal(new Set(rows.map(r=>r.id)).size,2);
  assert.deepEqual(await pendingDealerApprovals(owner),rows);
  write('dealers/memberships/first.json',{...EMPTY_MEMBERSHIP,agreement:{...agreement,approvedAt:'2026-11-03T12:00:00Z'}});
  assert.deepEqual((await pendingDealerApprovals(owner)).map(r=>r.dealerId),['second']);
 }finally{process.chdir(cwd);if(old===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=old;fs.rmSync(tmp,{recursive:true,force:true});}
});
