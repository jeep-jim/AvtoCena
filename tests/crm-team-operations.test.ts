import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
async function moduleFor(entry:string,state:any,extra:Record<string,string>={}){
 (globalThis as any).__teamTest=state;
 const mocks:Record<string,string>={
  auth:`export const isCrmRole=r=>['owner','admin','manager'].includes(r);export const isAdminRole=r=>['owner','admin'].includes(r);export const getCurrentUser=async()=>globalThis.__teamTest.actor;`,
  data:`const s=globalThis.__teamTest;export const readDataJson=async(k,f)=>s.files.get(k)??f;export const mutateDataJson=async(k,f,fn)=>{const v=fn(s.files.get(k)??f);s.files.set(k,v);return v};export const readChunkedDataJson=async k=>k.startsWith('leads')?s.leads||[]:s.clients||[];export const appendChunkedDataJson=async(k,row)=>{const rows=s.files.get(k)||[];s.files.set(k,[row,...rows]);return row;};export const readRecentChunkedDataJson=async(k,n,f)=>(s.files.get(k)||[]).filter(f).slice(0,n);`,
  'crm-users':`export const readCrmUsers=async()=>globalThis.__teamTest.users;`,
  'crm-activity':`export const recordCrmActivity=async(a,e)=>globalThis.__teamTest.events.push(e);`,...extra};
 const result=await build({entryPoints:[entry],bundle:true,format:'cjs',platform:'node',packages:'external',write:false,plugins:[{name:'team-test',setup(b){b.onResolve({filter:/^(\.\/|@\/lib\/)/},args=>{const name=args.path.split('/').at(-1)!;if(mocks[name])return {path:name,namespace:'mock'};});b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,m,m.exports);return m.exports;
}
const owner:any={id:'o',role:'owner',displayName:'Owner'},manager:any={id:'m',role:'manager',displayName:'Manager'},other:any={id:'b',role:'manager',displayName:'Other'},admin:any={id:'a',role:'admin',displayName:'Admin'};
test('team shifts require confirmation, reject stale edits, validate time and notify only affected colleague',async()=>{
 const state={files:new Map(),users:[owner,manager,other],events:[]};const api=await moduleFor('apps/web/lib/crm-team.ts',state);
 const input={userId:'m',date:'2026-10-01',start:'09:00',end:'18:00',expectedUpdatedAt:'',confirmed:true};
 await assert.rejects(api.saveShift(other,{...input,confirmed:false}),/Подтвердите/);
 await assert.rejects(api.saveShift(other,{...input,date:'2026-02-30'}),/дата/);
 await assert.rejects(api.saveShift(other,{...input,start:'20:00'}),/начало/);
 await assert.rejects(api.saveShift({...other,role:'partner'},input),/доступ/);
 const shift=await api.saveShift(other,input);assert.equal((await api.readSchedule('2026-10'))[0].start,'09:00');
 const notices=state.files.get('crm/notifications.json');assert.deepEqual(notices[0].recipientIds,['m']);assert.ok(notices[0].text.includes('Other'));assert.equal(notices[0].kind,'schedule');
 await assert.rejects(api.saveShift(owner,input),/уже изменён/);
 await api.saveShift(manager,{...input,expectedUpdatedAt:shift.updatedAt,off:true});assert.equal(state.files.get('crm/notifications.json').length,1,'self edit does not send a redundant notification');assert.equal((await api.readSchedule('2026-10'))[0].start,'');
 assert.equal(api.validateBirthDate('2000-02-29'),'2000-02-29');assert.throws(()=>api.validateBirthDate('2001-02-29'));assert.throws(()=>api.validateBirthDate('2100-01-01'));
 assert.equal(api.nextBirthday('2000-02-29',new Date('2027-02-27T23:00:00Z')),'2027-02-28');
});
test('unified notices keep recipient/read state separate and birthdays go only to owners/admins',async()=>{
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),birth=`1990-${today.slice(5)}`;
 const state={files:new Map([['crm/staff-profiles.json',{m:{birthDate:birth}}],['crm/notifications.json',[{id:'s',recipientIds:['m'],createdAt:new Date().toISOString(),kind:'schedule',title:'Shift',text:'Changed',href:'/crm/managers'}]]]),users:[owner,admin,manager,other],events:[]};
 const api=await moduleFor('apps/web/lib/crm-unified-notifications.ts',state,{'crm-reminders':`export const readReminders=async()=>[];`});
 const mine=await api.readNotifications(manager);assert.equal(mine.notifications.length,1);assert.equal(mine.notifications[0].id,'s');assert.equal((await api.readNotifications(other)).notifications.length,0);
 for(const actor of [owner,admin]){const rows=(await api.readNotifications(actor)).notifications;assert.equal(rows.length,1);assert.equal(rows[0].kind,'birthday');}
 const store=await moduleFor('apps/web/lib/crm-notification-store.ts',state);await store.markNotificationsRead('m',['s']);assert.equal((await api.readNotifications(manager)).notifications[0].unread,false);assert.equal((await api.readNotifications(owner)).notifications[0].unread,true);
});
test('staff documents are readable by self/authorized management, never by another manager',async()=>{
 const state={files:new Map(),users:[owner,admin,manager,other],events:[]};const api=await moduleFor('apps/web/lib/staff-documents.ts',state);
 assert.equal(api.canReadStaffDocuments(manager,manager),true);assert.equal(api.canManageStaffDocuments(manager,manager),false);assert.equal(api.canReadStaffDocuments(other,manager),false);
 assert.equal(api.canManageStaffDocuments(admin,manager),true);assert.equal(api.canManageStaffDocuments(admin,owner),false);assert.equal(api.canManageStaffDocuments(owner,admin),true);assert.equal(api.canManageStaffDocuments({...admin,permissions:{staff:false}},manager),false);
 await assert.rejects(api.staffDocumentAccess(other,'m'),/forbidden/);await assert.rejects(api.staffDocumentAccess(manager,'m',true),/forbidden/);
 assert.notEqual(api.staffDocumentKey('m','d'),api.staffDocumentKey('b','d'));
});
