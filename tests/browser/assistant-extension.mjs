import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {TeamAssistant} from './apps/web/components/crm/assistant/TeamAssistant';createRoot(document.getElementById('root')).render(<TeamAssistant/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',jsx:'automatic',outfile:'fixture.js',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const client=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const ext=path.resolve(process.env.ASSISTANT_EXTENSION_DIR||'apps/web/public/assistant-connector'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'bro-extension-'));
const browser=await chromium.launchPersistentContext(profile,{headless:true,executablePath:process.env.EXTENSION_CHROME_BIN||chromium.executablePath(),ignoreDefaultArgs:['--disable-extensions'],args:['--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
let loading=false,turn=null,posted=null;
const composer=`<main><div contenteditable="true" role="textbox" style="width:500px;height:90px;border:1px solid"></div><button data-testid="stop-button" style="display:none">Stop</button><button data-testid="send-button">Отправить</button></main><script>document.querySelector('[data-testid=send-button]').onclick=()=>{const input=document.querySelector('[contenteditable]'),u=document.createElement('div');u.dataset.messageAuthorRole='user';u.textContent=input.innerText;document.querySelector('main').append(u);input.innerText='';if(window.noAnswer)return;history.replaceState({},'','/c/fixture-chat');const a=document.createElement('div');a.dataset.messageAuthorRole='assistant';a.textContent=JSON.stringify({reply:'Ответ нового запроса'});document.querySelector('main').append(a);};</script>`;
try{
 await browser.route('https://avtocena.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Test CRM</title><body><style>'+css+'</style><div id="root"></div><script>'+client+'</script></body>'}));
 let messages=[],revision=0;
 await browser.route('https://avtocena.com/api/auth/me',r=>r.fulfill({json:{user:{id:'test-owner',role:'owner'}}}));
 await browser.route(/https:\/\/avtocena\.com\/api\/crm\/assistant(?:\?.*)?$/,async r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();posted=null;turn={id:crypto.randomUUID(),input:[{role:'user',content:body.text}]};
   for(let n=0;n<150&&!posted;n++)await new Promise(resolve=>setTimeout(resolve,100));
   if(!posted?.text)return r.fulfill({status:400,json:{error:posted?.error||'No bridge reply'}});
   messages.push({id:crypto.randomUUID(),role:'user',text:body.text,at:new Date().toISOString()},{id:crypto.randomUUID(),role:'assistant',text:JSON.parse(posted.text).reply,at:new Date().toISOString()});revision++;
  }
  return r.fulfill({json:{userId:'test-owner',messages,revision,connected:false,owner:true}});
 });
 await browser.route('https://avtocena.com/api/crm/assistant/browser**',r=>{if(r.request().method()==='POST'){posted=r.request().postDataJSON();turn=null;return r.fulfill({json:{ok:true}});}return r.fulfill({json:{turn}});});
 await browser.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Test ChatGPT</title><body>'+(loading?'Загрузка…':composer)+'</body>'}));
 await (browser.serviceWorkers()[0]||browser.waitForEvent('serviceworker',{timeout:10000}));
 const gpt=await browser.newPage();await gpt.goto('https://chatgpt.com/');
 const site=await browser.newPage();await site.goto('https://avtocena.com/crm');
 await site.evaluate(()=>{window.rpc=m=>new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timeout=setTimeout(()=>reject(Error('RPC timeout')),40000);const listener=e=>{if(e.data?.source==='avtocena-assistant-v1-reply'&&e.data.id===id){clearTimeout(timeout);window.removeEventListener('message',listener);resolve(e.data);}};window.addEventListener('message',listener);window.postMessage({source:'avtocena-assistant-v1',id,userId:'test-owner',...m},location.origin);});});
 const rpc=m=>site.evaluate(m=>window.rpc(m),m),tabs=()=>browser.pages().filter(p=>p.url().startsWith('https://chatgpt.com/'));
 assert.equal((await rpc({op:'ping'})).version,'1.0.2');
 await site.getByRole('button',{name:'Открыть ИИ-помощника',exact:true}).click();await site.getByRole('button',{name:'Подключить ChatGPT',exact:true}).click();await site.getByText('ИИ Бро подключён к отдельному служебному окну ChatGPT.',{exact:true}).waitFor().catch(async e=>{console.log('CONNECT DIAGNOSTIC',await site.locator('body').innerText(),browser.pages().map(p=>p.url()),await browser.serviceWorkers()[0].evaluate(()=>chrome.storage.session.get(null)));throw e;});assert.equal(tabs().length,2,'create dedicated tab, never reuse ordinary chat');const service=tabs().find(p=>p!==gpt);const worker=browser.serviceWorkers()[0];await worker.evaluate(async()=>{const all=await chrome.storage.session.get(null),b=Object.values(all).find(x=>x.managed===2);await chrome.scripting.executeScript({target:{tabId:b.tabId},func:()=>{const original=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,Math.max(ms,60000),...args);}});});
 await site.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Проверка возврата');await site.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await site.locator('.ta-assistant .ta-text').filter({hasText:'Ответ нового запроса'}).waitFor({timeout:12000});
 assert.equal(posted?.text,'{"reply":"Ответ нового запроса"}',JSON.stringify(posted));assert.equal(posted.error,'');
 await site.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Второе сообщение');await site.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await site.waitForFunction(()=>document.querySelectorAll('.ta-assistant').length===2,{timeout:12000});
 assert.equal(await gpt.locator('[data-message-author-role]').count(),0,'ordinary chat untouched');
 assert.equal((await rpc({op:'connect'})).ok,true,'reconnect to same bound conversation');assert.equal(tabs().length,2);
 // Simulate an old binding pointing at the user chat: migration must ignore it.
 await worker.evaluate(async()=>{const all=await chrome.storage.session.get(null);const key=Object.keys(all).find(k=>k.startsWith('binding:'));const b=all[key];delete b.managed;await chrome.storage.session.set({[key]:b});});
 const migrated=await rpc({op:'connect'});assert.equal(migrated.ok,true);assert.equal(tabs().length,3,'legacy binding replaced by a separate service chat');
 const fresh=tabs().find(p=>p!==gpt&&p!==service);await fresh.evaluate(()=>window.noAnswer=true);
 const cancelledId=crypto.randomUUID(),sending=rpc({op:'send',requestId:cancelledId,input:[{role:'user',content:'cancel test'}]});
 await fresh.locator('[data-message-author-role="user"]').waitFor();await rpc({op:'cancel',requestId:cancelledId});assert.equal((await sending).ok,false);
 await fresh.evaluate(()=>window.noAnswer=false);
 const next=await rpc({op:'send',requestId:crypto.randomUUID(),input:[{role:'user',content:'after cancel'}]});assert.equal(next.text,'{"reply":"Ответ нового запроса"}',JSON.stringify(next));
 console.log('actual extension: dedicated window, legacy migration, untouched user chat, throttled timers, hidden stop, SPA route, React panel answer return, second message and cancellation passed');
 await rpc({op:'disconnect'});loading=true;
 const failed=await rpc({op:'connect'});assert.equal(failed.ok,false);assert.equal(tabs().length,4,'one new tab for delayed load');
 const delayed=tabs().find(p=>p!==gpt&&p!==service&&p!==fresh);loading=false;await delayed.reload();
 const retried=await rpc({op:'connect'});assert.equal(retried.ok,true,JSON.stringify(retried));assert.equal(tabs().length,4,'retry must reuse reserved tab');
 const both=await Promise.all([rpc({op:'connect'}),rpc({op:'connect'})]);assert.ok(both.every(r=>r.ok));assert.equal(tabs().length,4,'concurrent retries cannot create tabs');
 console.log('actual extension: timeout, retry and concurrent retry passed without extra tabs');
 await delayed.goto('https://chatgpt.com/c/unrelated');await delayed.evaluate(()=>{const old=document.createElement('div');old.dataset.messageAuthorRole='assistant';old.textContent='PRIVATE OLD CHAT';document.querySelector('main').append(old);});
 const changed=await rpc({op:'connect'});assert.equal(changed.ok,false);assert.match(changed.error,/другой диалог/);assert.equal(tabs().length,4,'changed route must not create another tab');
 console.log('actual extension: unrelated conversation rejected without creating a tab');
}finally{await browser.close();fs.rmSync(profile,{recursive:true,force:true});}
