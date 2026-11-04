import test from 'node:test';
import assert from 'node:assert/strict';
import {changeDealerTeam,isDealerTeamOwner} from '../apps/web/lib/dealers/team';
import {keyMatches} from '../apps/web/lib/crm-access';
import type {AuthUser} from '../apps/web/lib/auth';
const owner:AuthUser={id:'owner',companyId:'dealer_test',role:'dealer',dealerTeamRole:'owner',dealerApproved:true,displayName:'Owner',telegramUsername:'owner',status:'active'};
const manager:AuthUser={...owner,id:'manager',telegramUsername:'manager',dealerTeamRole:'manager'};
test('dealer owner creates scoped staff with hashed credential, never platform privileges',()=>{
 const rows=changeDealerTeam([owner],owner.id,owner.companyId!,{action:'create',name:'Test',login:'test_manager',role:'owner',companyId:'dealer_topavto'},'secret');
 const created=rows[1];assert.equal(created.role,'dealer');assert.equal(created.companyId,owner.companyId);assert.equal(created.dealerTeamRole,'manager');assert.equal(created.dealerApproved,true);assert.ok(keyMatches('secret',created.accessKeyHash));assert.equal(JSON.stringify(rows).includes('secret'),false);
});
test('staff cannot manage team or cross company, owner must be explicit and approved',()=>{
 for(const actor of [manager,{...owner,dealerTeamRole:undefined},{...owner,dealerApproved:false},{...owner,status:'disabled' as const}])assert.throws(()=>changeDealerTeam([actor],actor.id,owner.companyId!,{action:'create',name:'x',login:'test_user'},'key'));
 assert.throws(()=>changeDealerTeam([owner],owner.id,'dealer_other',{action:'create',name:'x',login:'test_user'},'key'));
 assert.equal(isDealerTeamOwner({...owner,companyId:'dealer_topavto'}),false);
});
test('ten active staff limit, duplicate login, owner and other company protected',()=>{
 const users=[owner,...Array.from({length:10},(_,i)=>({...manager,id:'m'+i,telegramUsername:'staff'+i}))];
 assert.throws(()=>changeDealerTeam(users,owner.id,owner.companyId!,{action:'create',name:'x',login:'new_user'},'key'),/10 сотрудников/);
 assert.throws(()=>changeDealerTeam([owner,manager],owner.id,owner.companyId!,{action:'create',name:'x',login:'manager'},'key'),/занят/);
 for(const id of [owner.id,'foreign'])assert.throws(()=>changeDealerTeam([owner,{...manager,id:'foreign',companyId:'other'}],owner.id,owner.companyId!,{action:'disable',id},''));
});
test('disable invalidates sessions and key, rotation does not reactivate disabled staff',()=>{
 const rows=changeDealerTeam([owner,manager],owner.id,owner.companyId!,{action:'disable',id:manager.id},'');
 assert.equal(rows[1].status,'disabled');assert.equal(rows[1].dealerApproved,false);assert.equal(rows[1].sessionVersion,1);assert.equal(rows[1].accessKeyHash,'');assert.deepEqual(rows[0],owner);
 assert.throws(()=>changeDealerTeam(rows,owner.id,owner.companyId!,{action:'key',id:manager.id},'key'));
});
