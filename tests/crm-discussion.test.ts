import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {discussionHref,discussionMessages} from '../apps/web/lib/crm-discussion';const require=createRequire(import.meta.url);
test('discussion links identify the entity and message, and legacy notes remain visible',()=>{assert.equal(discussionHref('lead','l','n'),'/crm/leads?id=l&message=n#discussion-lead-l');assert.equal(discussionHref('client','c'),'/crm/clients/c#discussion-client-c');assert.equal(discussionMessages({internalNotes:[{text:'Old note',createdByName:'Manager'}]})[0].text,'Old note');});
test('chat preserves assignment/status, appends replies once and notifies only permitted colleagues',async()=>{
 const state:any={users:[{id:'owner',role:'owner',displayName:'Owner',companyId:'one'},{id:'m',role:'manager',displayName:'Manager',companyId:'one'},{id:'other',role:'manager',displayName:'Other',companyId:'one'},{id:'foreign',role:'owner',displayName:'Foreign',companyId:'two'}],leads:[{id:'l',name:'Игорь',car:'RAV4',assignedManagerId:'m',status:'contacted',internalNotes:[{id:'old',text:'Prior note',createdByUserId:'owner'}]}],clients:[{id:'c',fio:'Client',assignedManagerId:'m'}],events:[],notices:[]};(globalThis as any).__chat=state;
 const sources:any={'./auth':`export const isCrmRole=r=>['owner','admin','manager'].includes(r);`,'./crm-users':`export const readCrmUsers=async()=>globalThis.__chat.users;`,'./data':`const s=globalThis.__chat;export const readChunkedDataJson=async p=>p.startsWith('leads')?s.leads:s.clients;export const updateChunkedDataJson=async(p,id,fn)=>{const rows=p.startsWith('leads')?s.leads:s.clients;const i=rows.findIndex(x=>x.id===id);if(i<0)return null;return rows[i]=fn(rows[i]);};`,'./crm-activity':`export const recordCrmActivity=async(u,e)=>globalThis.__chat.events.push(e);`,'./crm-notification-store':`export const notifyTeam=async n=>globalThis.__chat.notices.push(n);`};
 const output=await build({entryPoints:['apps/web/lib/crm-discussion-store.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'chat',setup(b){b.onResolve({filter:/^\.\//},a=>sources[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:sources[a.path],loader:'ts'}));}}]});const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);const api=m.exports;
 try{const user=state.users[1],message={text:'Answer',operationId:'operation-123',replyTo:'old'};await assert.rejects(api.readDiscussion(state.users[2],'lead','l'),/forbidden/);await assert.rejects(api.addDiscussionMessage({...user,permissions:{editLeads:false}},'lead','l',message),/forbidden/);await assert.rejects(api.addDiscussionMessage(user,'lead','l',{...message,replyTo:'missing'}),/invalid_reply/);
 const result=await api.addDiscussionMessage(user,'lead','l',message);assert.equal(result.messages.length,2);assert.equal(result.messages[1].replyTo,'old');assert.equal(state.leads[0].assignedManagerId,'m');assert.equal(state.leads[0].status,'contacted');assert.equal(state.notices.length,1);assert.deepEqual(state.notices[0].recipientIds,['owner']);assert.match(state.notices[0].title,/Игорь.*RAV4/);assert.match(state.notices[0].href,/#discussion-lead-l/);
 await api.addDiscussionMessage(user,'lead','l',message);assert.equal(state.leads[0].internalNotes.length,2);assert.equal(state.notices.length,1);assert.equal(state.events.length,1);await assert.rejects(api.addDiscussionMessage(user,'lead','l',{...message,text:'different'}),/message_conflict/);
 const noteId=result.messages[1].id;
 await assert.rejects(api.editDiscussionMessage(state.users[0],'lead','l',{messageId:noteId,text:'Other author',expectedText:'Answer'}),/forbidden/);
 await assert.rejects(api.editDiscussionMessage({...user,permissions:{editLeads:false}},'lead','l',{messageId:noteId,text:'No rights',expectedText:'Answer'}),/forbidden/);
 await assert.rejects(api.editDiscussionMessage(user,'lead','l',{messageId:noteId,text:'   ',expectedText:'Answer'}),/invalid_message/);
 const edited=await api.editDiscussionMessage(user,'lead','l',{messageId:noteId,text:'Corrected answer',expectedText:'Answer'});
 assert.equal(edited.messages[1].text,'Corrected answer');assert.ok(edited.messages[1].editedAt);assert.equal(edited.messages[1].replyTo,'old');assert.equal(state.leads[0].status,'contacted');assert.equal(state.leads[0].assignedManagerId,'m');assert.equal(state.leads[0].internalNotes.length,2);assert.equal(state.notices.length,1);assert.equal(state.events.length,2);
 await api.editDiscussionMessage(user,'lead','l',{messageId:noteId,text:'Corrected answer',expectedText:'Answer'});assert.equal(state.events.length,2);
 await assert.rejects(api.editDiscussionMessage(user,'lead','l',{messageId:noteId,text:'Stale edit',expectedText:'Answer'}),/edit_conflict/);

 await api.reactDiscussionMessage(user,'lead','l',{messageId:noteId,emoji:'👍',active:true});
 await api.reactDiscussionMessage(user,'lead','l',{messageId:noteId,emoji:'👍',active:true});
 assert.deepEqual(state.leads[0].internalNotes[1].reactions['👍'],['m']);
 await api.reactDiscussionMessage(state.users[0],'lead','l',{messageId:noteId,emoji:'👍',active:true});
 await api.reactDiscussionMessage(user,'lead','l',{messageId:noteId,emoji:'👍',active:false});
 assert.deepEqual(state.leads[0].internalNotes[1].reactions['👍'],['owner']);
 await assert.rejects(api.reactDiscussionMessage(state.users[2],'lead','l',{messageId:noteId,emoji:'👍',active:true}),/forbidden/);
 await assert.rejects(api.reactDiscussionMessage(user,'lead','l',{messageId:noteId,emoji:'bad',active:true}),/invalid_message/);
 const targets=await api.discussionTargets(user);assert.equal(targets.length,2);
 const forwarded=await api.addDiscussionMessage(user,'client','c',{text:'Forged',operationId:'forward-op-123',forwardFrom:{type:'lead',id:'l',messageId:noteId}});
 assert.equal(forwarded.messages[0].text,'Corrected answer');assert.equal(forwarded.messages[0].forwarded.author,'Manager');
 await assert.rejects(api.addDiscussionMessage(state.users[2],'client','c',{operationId:'forward-denied',forwardFrom:{type:'lead',id:'l',messageId:noteId}}),/forbidden/);
 const withFile=await api.addDiscussionMessage(user,'lead','l',{text:'file',operationId:'attachment-123'},{id:'private-file',name:'quote.pdf',mime:'application/pdf',size:50});
 assert.equal(withFile.messages.at(-1).attachment.id,'private-file');
 const forged=await api.addDiscussionMessage(user,'lead','l',{text:'test',operationId:'forged-file-123',attachment:{id:'unowned-file'}});
 assert.equal(forged.messages.at(-1).attachment,undefined);
 await assert.rejects(api.addDiscussionMessage(user,'client','c',{operationId:'forward-file',forwardFrom:{type:'lead',id:'l',messageId:withFile.messages.at(-1).id}}),/invalid_message/);
 await api.addDiscussionMessage(user,'client','c',{text:'Client note',operationId:'operation-client'});assert.equal(state.clients[0].internalNotes.at(-1).text,'Client note');state.leads[0].assignedManagerId='other';await assert.rejects(api.addDiscussionMessage(user,'lead','l',{text:'No access',operationId:'operation-denied'}),/forbidden/);
 }finally{delete (globalThis as any).__chat;}
});
