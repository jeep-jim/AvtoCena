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
// Conversation deliberately lives outside an unrelated <main>, as in newer shells.
const composer=`<main><p>Navigation shell</p></main><section id="conversation"></section><form onsubmit="return false"><div contenteditable="true" role="textbox" style="width:500px;height:90px;border:1px solid"></div><button data-testid="stop-button" style="display:none">Stop</button><button data-testid="send-button">Отправить</button></form><script>
const provider=location.hostname==='chat.deepseek.com'?'deepseek':location.hostname==='alice.yandex.ru'?'alice':location.hostname==='www.google.com'?'googleai':'gpt';
function respond(prompt){const u=document.createElement('div');u.setAttribute('data-own-test-user','true');u.innerHTML='<span></span>';u.firstChild.textContent=prompt;document.querySelector('#conversation').append(u);const a=document.createElement('div');if(provider==='deepseek')a.className='ds-markdown';else if(provider==='alice')a.className='AssistantMessage';else if(provider==='googleai')a.setAttribute('data-attrid','wa:/description');else a.className='markdown prose';a.textContent=JSON.stringify({reply:'Ответ нового запроса'});document.querySelector('#conversation').append(a);}
if(provider==='googleai'&&sessionStorage.resumePrompt){respond(sessionStorage.resumePrompt);sessionStorage.removeItem('resumePrompt');}
document.querySelector('[data-testid=send-button]').onclick=()=>{const input=document.querySelector('[contenteditable]'),prompt=input.innerText;input.innerText='';if(window.noAnswer){const u=document.createElement('div');u.dataset.messageAuthorRole='user';u.textContent=prompt;document.querySelector('#conversation').append(u);return;}if(provider==='googleai'){sessionStorage.resumePrompt=prompt;location.href='/search?udm=50';return;}history.replaceState({},'',provider==='deepseek'?'/a/chat/s/test':provider==='alice'?'/chat/fixture_alice/':'/c/fixture_chat/');setTimeout(()=>respond(prompt),provider==='gpt'?6500:200);};</script>`;

try{
 await browser.route('https://avtocena.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Test CRM</title><body><style>'+css+'</style><div id="root"></div><script>'+client+'</script></body>'}));
 let messages=[],revision=0;
 await browser.route('https://avtocena.com/api/auth/me',r=>r.fulfill({json:{user:{id:'test-owner',role:'owner'}}}));
 await browser.route(/https:\/\/avtocena\.com\/api\/crm\/assistant(?:\?.*)?$/,async r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();posted=null;turn={id:crypto.randomUUID(),input:[{role:'user',content:body.text}]};
   for(let n=0;n<150&&!posted;n++)await new Promise(resolve=>setTimeout(resolve,100));
   if(!posted?.text)return r.fulfill({status:400,json:{error:posted?.error||'No bridge reply'}});
   messages.push({id:crypto.randomUUID(),role:'user',provider:body.provider,text:body.text,at:new Date().toISOString()},{id:crypto.randomUUID(),role:'assistant',provider:body.provider,text:JSON.parse(posted.text).reply,at:new Date().toISOString()});revision++;
  }
  return r.fulfill({json:{userId:'test-owner',messages,revision,connected:false,owner:true}});
 });
 await browser.route('https://avtocena.com/api/crm/assistant/browser**',r=>{if(r.request().method()==='POST'){posted=r.request().postDataJSON();turn=null;return r.fulfill({json:{ok:true}});}return r.fulfill({json:{turn}});});
 await browser.route(/^https:\/\/(chatgpt\.com|chat\.deepseek\.com|alice\.yandex\.ru|www\.google\.com)\//,r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Test ChatGPT</title><body>'+(loading?'Загрузка…':composer)+'</body>'}));
 await (browser.serviceWorkers()[0]||browser.waitForEvent('serviceworker',{timeout:10000}));
 const gpt=await browser.newPage();await gpt.goto('https://chatgpt.com/');
 const site=await browser.newPage();await site.goto('https://avtocena.com/crm');
 await site.evaluate(()=>{window.rpc=m=>new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timeout=setTimeout(()=>reject(Error('RPC timeout')),40000);const listener=e=>{if(e.data?.source==='avtocena-assistant-v1-reply'&&e.data.id===id){clearTimeout(timeout);window.removeEventListener('message',listener);resolve(e.data);}};window.addEventListener('message',listener);window.postMessage({source:'avtocena-assistant-v1',id,userId:'test-owner',...m},location.origin);});});
 // Extension-created popup initial navigation can precede Playwright interception.
 // Navigate its test page explicitly so it receives the same deterministic fixture.
 let fixtureUrl='https://chatgpt.com/';browser.on('page',p=>{void p.goto(fixtureUrl).catch(()=>{});});
 const rpc=m=>site.evaluate(m=>window.rpc(m),m),tabs=()=>browser.pages().filter(p=>p.url().startsWith('https://chatgpt.com/'));
 assert.equal((await rpc({op:'ping'})).version,'1.0.5');
 const beforeConnect=await rpc({op:'diagnose'});assert.equal(beforeConnect.ok,true);assert.ok(beforeConnect.diagnostic);assert.ok(!JSON.stringify(beforeConnect).includes('PRIVATE'));
 await site.getByRole('button',{name:'Открыть ИИ-помощника',exact:true}).click();await site.getByRole('button',{name:'Подключить ChatGPT',exact:true}).click();await site.getByText('ChatGPT подключён. Пишите здесь — ответ появится в этом чате.',{exact:true}).waitFor().catch(async e=>{console.log('CONNECT DIAGNOSTIC',await site.locator('body').innerText(),await Promise.all(browser.pages().map(p=>p.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText.slice(0,700),hidden:document.hidden,editors:[...document.querySelectorAll('[contenteditable]')].map(e=>({html:e.outerHTML,editable:e.isContentEditable,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility}))})))),await browser.serviceWorkers()[0].evaluate(()=>chrome.storage.session.get(null)));throw e;});assert.equal(tabs().length,2,'create dedicated tab, never reuse ordinary chat');const service=tabs().find(p=>p!==gpt);const worker=browser.serviceWorkers()[0];await worker.evaluate(async()=>{const all=await chrome.storage.session.get(null),b=Object.values(all).find(x=>x.managed===3);await chrome.scripting.executeScript({target:{tabId:b.tabId},func:()=>{const original=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>original(fn,Math.max(ms,60000),...args);}});});
 await site.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Проверка возврата');await site.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await site.locator('.ta-assistant .ta-text').filter({hasText:'Ответ нового запроса'}).waitFor({timeout:12000});
 assert.equal(posted?.text,'{"reply":"Ответ нового запроса"}',JSON.stringify(posted));assert.equal(posted.error,'');
 await site.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Второе сообщение');await site.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
 await site.waitForFunction(()=>document.querySelectorAll('.ta-assistant').length===2,{timeout:12000});
 assert.equal(await gpt.locator('[data-message-author-role]').count(),0,'ordinary chat untouched');
 const diagnosis=await rpc({op:'diagnose'});assert.equal(diagnosis.diagnostic.composer,true);assert.equal(diagnosis.diagnostic.route,'conversation');assert.ok(!JSON.stringify(diagnosis).includes('/c/'));
 assert.equal((await rpc({op:'connect'})).ok,true,'reconnect to same bound conversation');assert.equal(tabs().length,2);
 // All providers share the internal timeline, each with its own service binding.
 for(const [provider,name,url] of [['alice','Алиса','https://alice.yandex.ru/'],['googleai','Google','https://www.google.com/ai'],['deepseek','DeepSeek','https://chat.deepseek.com/']]){
  fixtureUrl=provider==='googleai'?'https://www.google.com/search?udm=50&aep=11':url;await site.getByRole('button',{name:'Написать '+name,exact:true}).click();await site.getByRole('button',{name:'Подключить '+name,exact:true}).click();await site.getByText(name+' подключён. Пишите здесь — ответ появится в этом чате.',{exact:true}).waitFor().catch(async e=>{console.log('PROVIDER CONNECT',name,await site.locator('.ta-panel').innerText(),await Promise.all(browser.pages().map(p=>p.evaluate(()=>({url:location.href,text:document.body.innerText.slice(0,250)})))) ,await worker.evaluate(async()=>{const all=await chrome.storage.session.get(null);return await Promise.all(Object.values(all).map(async b=>({provider:b.provider,tabId:b.tabId,probe:await chrome.tabs.sendMessage(b.tabId,{op:'inspect'}).catch(e=>e.message)})));}));throw e;});
  await site.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Привет, '+name);await site.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
  await site.waitForFunction(name=>[...document.querySelectorAll('.ta-assistant .ta-author')].some(e=>e.textContent.startsWith(name)),name,{timeout:15000});
  assert.equal(posted.error,'');assert.equal(posted.text,'{"reply":"Ответ нового запроса"}');
  const bindings=await worker.evaluate(()=>chrome.storage.session.get(null));assert.ok(Object.values(bindings).some(b=>b.provider===provider));
 }
 assert.equal(await site.locator('.ta-assistant').count(),5,'all replies remain in one internal chat');
 fixtureUrl='https://chatgpt.com/';await site.getByRole('button',{name:'Написать ChatGPT',exact:true}).click();
 console.log('ChatGPT, Alice, Google replies returned to the React panel; Google full navigation resumed without resend');
 // Simulate an old binding pointing at the user chat: migration must ignore it.
 await worker.evaluate(async()=>{const all=await chrome.storage.session.get(null);const key=Object.keys(all).find(k=>k.endsWith(':gpt'));const b=all[key];delete b.managed;await chrome.storage.session.set({[key]:b});});
 const migrated=await rpc({op:'connect'});assert.equal(migrated.ok,true);assert.equal(tabs().length,3,'legacy binding replaced by a separate service chat');
 const fresh=tabs().find(p=>p!==gpt&&p!==service);await fresh.evaluate(()=>window.noAnswer=true);
 const cancelledId=crypto.randomUUID(),sending=rpc({op:'send',requestId:cancelledId,input:[{role:'user',content:'cancel test'}]});
 await fresh.locator('[data-message-author-role="user"]').waitFor();await rpc({op:'cancel',requestId:cancelledId});assert.equal((await sending).ok,false);
 await fresh.reload();await rpc({op:'connect'});await fresh.evaluate(()=>window.noAnswer=false);
 const next=await rpc({op:'send',requestId:crypto.randomUUID(),input:[{role:'user',content:'after cancel'}]});assert.equal(next.text,'{"reply":"Ответ нового запроса"}',JSON.stringify(next));
 console.log('actual extension: dedicated window, legacy migration, untouched user chat, throttled timers, hidden stop, delayed echo after route change, missing user wrapper, opaque route ID, React panel answer return, second message and cancellation passed');
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
