import test from 'node:test';
import assert from 'node:assert/strict';
import {changeIdea,ideaInput,requireIdeaTeam,publicIdea,numberIdeas,type TeamIdea} from '../apps/web/lib/team-ideas';
import type {AuthUser} from '../apps/web/lib/auth';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const owner={id:'owner',displayName:'Владелец',telegramUsername:'owner',role:'owner',companyId:'dealer_topavto'} as AuthUser;
const manager={...owner,id:'manager',role:'manager'} as AuthUser;
const row:TeamIdea={id:'idea',title:'Идея',description:'Текст',authorId:'manager',authorName:'Сотрудник',createdAt:'2026-10-07',updatedAt:'2026-10-07',progress:0,votes:[],screenshots:[]};
test('ideas: only active platform team, owner alone can set progress',()=>{
 for(const u of [null,{...owner,companyId:'external'},{...owner,status:'disabled'},{...owner,role:'dealer'},{...owner,companyId:undefined}])assert.throws(()=>requireIdeaTeam(u as any),/ideas_forbidden/);
 requireIdeaTeam(manager);
 for(const role of ['manager','admin'])assert.throws(()=>changeIdea(row,{...manager,role} as AuthUser,'progress',50),/ideas_forbidden/);
 assert.equal(changeIdea(row,owner,'progress',100).progress,100);
 for(const n of [-1,101,1.2,'50',NaN])assert.throws(()=>changeIdea(row,owner,'progress',n));
});
test('votes are idempotent per user and changing progress preserves votes',()=>{
 const once=changeIdea(row,manager,'vote',true),twice=changeIdea(once,manager,'vote',true);
 assert.deepEqual(twice.votes,['manager']);
 const other=changeIdea(twice,owner,'vote',true);assert.equal(other.votes.length,2);
 assert.deepEqual(changeIdea(other,owner,'progress',75).votes,other.votes);
 assert.deepEqual(changeIdea(other,manager,'vote',false).votes,['owner']);
 assert.equal(publicIdea(other,manager).voted,true);assert.equal(publicIdea(other,manager).voteCount,2);assert.equal(publicIdea(other,manager).votes,undefined);
});
test('idea text is bounded and client fields do not provide author or progress',()=>{
 assert.deepEqual(ideaInput({title:'  Идея ',description:' Текст '}),{title:'Идея',description:'Текст'});
 for(const input of [{title:'',description:'x'},{title:'x',description:''},{title:'x'.repeat(161),description:'x'},{title:'x',description:'x'.repeat(12001)}])assert.throws(()=>ideaInput(input));
});
test('HTTP: private media, persisted screenshot, idempotent concurrent votes, owner progress and origin checks',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 const out=path.resolve('artifacts/team-ideas-tests');fs.mkdirSync(out,{recursive:true});const modules:any={};
 for(const [name,entry] of Object.entries({api:'apps/web/app/(crm)/api/crm/ideas/route.ts',media:'apps/web/app/(crm)/api/crm/ideas/media/[ideaId]/[file]/route.ts'})){
  const outfile=path.join(out,name+'.cjs');await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'actor',setup(b){b.onResolve({filter:/^@\/lib\/auth$/},()=>({path:'actor',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function getCurrentUser(){return globalThis.__ideaActor||null} export function getAuthUsers(){return []} export function normalizeTelegramUsername(v){return v}'}));}}]});modules[name]=require(outfile);
 }
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ideas-test-'));fs.mkdirSync(path.join(tmp,'data'));
 process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';
 const post=(body:any,origin='https://avtocena.com')=>new Request('https://avtocena.com/api/crm/ideas',{method:'POST',headers:{origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});
 try{
  (globalThis as any).__ideaActor={...owner,companyId:'external'};assert.equal((await modules.api.GET()).status,403);
  (globalThis as any).__ideaActor=manager;
  assert.equal((await modules.api.POST(post({},'https://attacker.example'))).status,403);
  const sharp=(await import('sharp')).default;const png=await sharp({create:{width:20,height:20,channels:3,background:'#fff'}}).png().toBuffer();
  const form=new FormData();form.set('title','Скриншот');form.set('description','**Текст** https://example.com');form.append('screenshots',new Blob([png],{type:'image/png'}),'screen.png');
  assert.equal((await modules.api.POST(post(form))).status,200);
  let result=await (await modules.api.GET()).json();let item=result.ideas[0];assert.equal(item.authorId,'manager');assert.equal(item.progress,0);assert.equal(item.screenshots.length,1);
  assert.equal((await modules.api.POST(post({id:item.id,action:'progress',value:80}))).status,403);
  await Promise.all(Array.from({length:4},()=>modules.api.POST(post({id:item.id,action:'vote',value:true}))));
  result=await (await modules.api.GET()).json();assert.equal(result.ideas[0].voteCount,1);
  const context={params:Promise.resolve({ideaId:item.id,file:item.screenshots[0].split('/')[1]})};
  const photo=await modules.media.GET(new Request('https://avtocena.com'),context);assert.equal(photo.status,200);assert.equal(photo.headers.get('Cache-Control'),'private, no-store');assert.equal(photo.headers.get('Content-Type'),'image/webp');
  (globalThis as any).__ideaActor=null;assert.equal((await modules.media.GET(new Request('https://avtocena.com'),context)).status,403);
  (globalThis as any).__ideaActor=owner;assert.equal((await modules.api.POST(post({id:item.id,action:'progress',value:80}))).status,200);
  result=await (await modules.api.GET()).json();assert.equal(result.ideas[0].progress,80);assert.equal(result.ideas[0].voteCount,1);
  await Promise.all(['Second','Third'].map(async title=>{const f=new FormData();f.set('title',title);f.set('description','Text');assert.equal((await modules.api.POST(post(f))).status,200);}));
  result=await (await modules.api.GET()).json();assert.deepEqual(result.ideas.map((r:any)=>r.number).sort(),[1,2,3]);assert.equal(result.ideas.find((r:any)=>r.id===item.id).number,1);
  const editForm=(revision:number)=>{const f=new FormData();f.set('id',item.id);f.set('revision',String(revision));f.set('title','Исправленная идея');f.set('description','Новое описание');f.append('retain',item.screenshots[0]);return f;};
  (globalThis as any).__ideaActor={...manager,id:'other'};assert.equal((await modules.api.POST(post(editForm(0)))).status,403);
  (globalThis as any).__ideaActor=manager;assert.equal((await modules.api.POST(post(editForm(0)))).status,200);
  assert.equal((await modules.api.POST(post(editForm(0)))).status,409);
  result=await (await modules.api.GET()).json();const edited=result.ideas.find((r:any)=>r.id===item.id);assert.equal(edited.title,'Исправленная идея');assert.equal(edited.number,1);assert.equal(edited.progress,80);assert.equal(edited.voteCount,1);assert.equal(edited.screenshots.length,1);
  (globalThis as any).__ideaActor={...manager,id:'other',displayName:'Другой сотрудник'};
  const comment=new FormData();comment.set('id',item.id);comment.set('action','comment');comment.set('text','Обоснование https://example.com');comment.append('screenshots',new Blob([png],{type:'image/png'}),'comment.png');
  assert.equal((await modules.api.POST(post(comment))).status,200);
  result=await (await modules.api.GET()).json();const commented=result.ideas.find((r:any)=>r.id===item.id);assert.equal(commented.comments.length,1);assert.equal(commented.comments[0].author.id,'other');assert.equal(commented.revision,1);assert.equal(commented.voteCount,1);
  const commentContext={params:Promise.resolve({ideaId:item.id,file:commented.comments[0].screenshots[0].split('/')[1]})};
  assert.equal((await modules.media.GET(new Request('https://avtocena.com'),commentContext)).status,200);
  const empty=new FormData();empty.set('id',item.id);empty.set('action','comment');empty.set('text',' ');assert.equal((await modules.api.POST(post(empty))).status,400);
  (globalThis as any).__ideaActor={...manager,companyId:'external'};assert.equal((await modules.api.POST(post(comment))).status,403);assert.equal((await modules.media.GET(new Request('https://avtocena.com'),commentContext)).status,403);
  (globalThis as any).__ideaActor=owner;const removal=editForm(1);removal.delete('retain');assert.equal((await modules.api.POST(post(removal))).status,200);assert.equal((await modules.media.GET(new Request('https://avtocena.com'),context)).status,404);
  assert.equal((await modules.media.GET(new Request('https://avtocena.com'),commentContext)).status,200);

 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;delete (globalThis as any).__ideaActor;fs.rmSync(tmp,{recursive:true,force:true});}
});
test('formatted text escapes HTML and only makes HTTP(S) URLs clickable',async()=>{
 const outfile=path.resolve('artifacts/team-ideas-tests/text.cjs');await build({entryPoints:['apps/web/components/crm/IdeaText.tsx'],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic'});
 const {IdeaText}=require(outfile);const html=renderToStaticMarkup(React.createElement(IdeaText,{text:'**Жирный** [u]Линия[/u] [color=red]Цвет[/color] <script>alert(1)</script> javascript:alert(1) https://example.com'}));
 assert.ok(html.includes('<strong>Жирный</strong>'));assert.ok(html.includes('<u>Линия</u>'));assert.ok(html.includes('idea-color-red'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('href="https://example.com/"'));assert.ok(html.includes('noopener noreferrer'));
});

test('against votes switch sides exclusively, remain idempotent and can be removed',()=>{
 const yes=changeIdea(row,manager,'vote','for');
 const no=changeIdea(yes,manager,'vote','against');assert.deepEqual(no.votes,[]);assert.deepEqual(no.downvotes,['manager']);
 assert.deepEqual(changeIdea(no,manager,'vote','against').downvotes,['manager']);
 assert.deepEqual(changeIdea(no,manager,'vote',null).downvotes,[]);
 assert.deepEqual(changeIdea(no,manager,'vote','for').downvotes,[]);
 const view=publicIdea(no,owner,[{...manager,displayName:'Антон',avatarUrl:'/avatars/test.webp'}]);
 assert.equal(view.againstCount,1);assert.equal(view.opponents[0].name,'Антон');assert.equal(view.opponents[0].avatar,'/avatars/test.webp');assert.equal(view.author.avatar.includes('/avatars/'),true);
});
test('migration assigns chronological permanent numbers and never renumbers existing ideas',()=>{
 const old={...row,id:'old',createdAt:'2026-10-06'},recent={...row,id:'recent',createdAt:'2026-10-07'};
 const rows=numberIdeas([recent,old]);assert.equal(rows[0].number,2);assert.equal(rows[1].number,1);
 assert.deepEqual(numberIdeas([...rows].reverse()).map(r=>r.number),[1,2]);
 assert.equal(numberIdeas([{...row,id:'new'},...rows])[0].number,3);
});
