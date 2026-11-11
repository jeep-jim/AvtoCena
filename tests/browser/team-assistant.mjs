import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/team-assistant';fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {TeamAssistant} from './apps/web/components/crm/assistant/TeamAssistant';import {AssistantLauncher} from './apps/web/components/crm/assistant/AssistantLauncher';createRoot(document.getElementById('root')).render(<><main className="crm-content"><h1>Команда и права</h1><aside className="team-assistant-card"><img src="/avatars/gpt-assistant.svg"/><strong>ИИ-помощник команды</strong><p>Поиск, подсказки и помощь с заполнением — прямо на сайте.</p><AssistantLauncher/></aside><form><label>Мощность, л. с.<input name="powerHp" defaultValue=""/></label><label>Пароль<input type="password" defaultValue="PRIVATE"/></label><button type="submit">Сохранить</button></form></main><TeamAssistant/></>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:out+'/fixture.js',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture-navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'next/navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const usePathname=()=>location.pathname;`,loader:'js'}));}}]});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [1440,390,360]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let connected=true,visitor=false,revision=0,messages=[],captured,actions=0,submits=0;
  await page.route('https://assistant.test/**',async route=>{
   const u=new URL(route.request().url()),body=route.request().postDataJSON();
   if(u.pathname==='/api/auth/me')return route.fulfill({contentType:'application/json',body:JSON.stringify({user:visitor?null:{id:'owner',role:'owner'}})});
   if(u.pathname==='/api/crm/assistant'){
    if(route.request().method()==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify({userId:'owner',name:'Иван',owner:true,canCode:true,canFill:true,canControlPage:true,pageControl:true,connected,codeConnected:false,messages,revision})});
    assert.equal(body.revision,revision);
    if(body.op==='message'){captured=body.context;assert.ok(!JSON.stringify(captured).includes('PRIVATE'));const f=captured.fields.find(f=>f.label.startsWith('Мощность'));assert.ok(f);const action={id:'00000000-0000-4000-8000-000000000001',kind:'fill',summary:'Заполнить мощность',path:captured.path,fields:[{id:f.id,label:f.label,before:f.value,value:'150'}]};messages=[{id:'u',role:'user',text:body.text,at:new Date().toISOString()},{id:'a',role:'assistant',text:'Проверьте модификацию перед сохранением. [Источник](https://example.com)',at:new Date().toISOString(),actions:[action]}];revision++;}
    if(body.op==='action'){actions++;messages[1].actions[0].status='done';revision++;return route.fulfill({contentType:'application/json',body:JSON.stringify({messages,revision,action:messages[1].actions[0]})});}
    return route.fulfill({contentType:'application/json',body:JSON.stringify({messages,revision})});
   }
   if(u.pathname.endsWith('.svg'))return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync('apps/web/public/avatars/gpt-assistant.svg','utf8')});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ac-border:#dfe5eb;--ac-muted:#657386}body{margin:0;font:14px/1.5 Arial;background:#edf1f6;color:#162131}.crm-content{padding:18px;max-width:1200px;margin:auto}h1{font-size:26px}label{display:grid;gap:5px;margin-bottom:12px}input{padding:10px;border:1px solid #ddd;border-radius:9px}</style><div id="root"></div></html>'});
  });
  await page.goto('https://assistant.test/crm/leads');await page.addStyleTag({content:fs.readFileSync(out+'/fixture.css','utf8')});await page.addScriptTag({content:fs.readFileSync(out+'/fixture.js','utf8')});
  await page.getByRole('button',{name:'Открыть ИИ-помощника'}).waitFor();
  await page.evaluate(()=>document.querySelector('main form').addEventListener('submit',e=>{e.preventDefault();window.formSubmitted=true;}));
  const card=await page.locator('.team-assistant-card').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,desc:el.querySelector('p').getBoundingClientRect().width}));assert.ok(card.scroll<=card.width+1);if(width<900)assert.ok(card.desc>250);
  await page.screenshot({path:`${out}/card-${width}.png`});
  await page.getByRole('button',{name:'Чат с ИИ-помощником'}).click();await page.locator('dialog[open]').waitFor();
  const dims=await page.locator('dialog').evaluate(el=>({right:el.getBoundingClientRect().right,width:el.clientWidth,scroll:el.scrollWidth,modal:el.matches(':modal'),body:parseFloat(getComputedStyle(document.body).paddingRight),input:el.querySelector('textarea').getBoundingClientRect().bottom}));
  assert.equal(dims.modal,width<900);assert.ok(dims.scroll<=dims.width+1);assert.ok(dims.input<844);assert.ok(Math.abs(dims.right-width)<2);if(width>900)assert.ok(dims.body>=340);
  await page.screenshot({path:`${out}/open-${width}.png`});
  if(width>900){await page.getByRole('separator').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('separator').getAttribute('aria-valuenow'),'440');}
  await page.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Помоги заполнить мощность');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await page.getByRole('button',{name:'Заполнить эти поля'}).waitFor();
  await page.getByRole('button',{name:'Заполнить эти поля'}).click();await page.getByText('Поля заполнены. Проверьте их и сохраните форму обычной кнопкой.').waitFor();assert.equal(await page.locator('input[name=powerHp]').inputValue(),'150');assert.equal(actions,1);assert.equal(await page.evaluate(()=>Boolean(window.formSubmitted)),false);
  await page.screenshot({path:`${out}/chat-${width}.png`});
  await page.getByRole('button',{name:'Закрыть помощника',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.evaluate(()=>document.documentElement.dataset.teamAssistantOpen||''),'');
  connected=false;await page.getByRole('button',{name:'Открыть ИИ-помощника'}).click();await page.locator('.ta-contextbar').getByText('Подключите ChatGPT',{exact:true}).waitFor();await page.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Проверка');assert.equal(await page.getByRole('button',{name:'Отправить сообщение',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');if(width>900)await page.getByRole('button',{name:'Закрыть помощника',exact:true}).click();
  visitor=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByRole('button',{name:'Открыть ИИ-помощника'}).waitFor({state:'detached'});
  assert.deepEqual(errors,[]);await page.close();console.log(`assistant ${width}: split/sheet, compact card, resize, draft fill, no submit, offline, logout passed`);
 }
}finally{await browser.close();}
