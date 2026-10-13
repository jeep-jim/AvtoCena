import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out='artifacts/assistant-layout';fs.mkdirSync(out,{recursive:true});
let server,origin;
{
 await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PublicHeader} from './apps/web/components/layout/PublicHeader';import {CrmShellView} from './apps/web/components/crm/CrmShellView';import {TeamAssistant} from './apps/web/components/crm/assistant/TeamAssistant';import {StaffPermissions} from './apps/web/components/crm/StaffPermissions';const content=<div style={{height:1800}}>Контекст страницы</div>;createRoot(document.getElementById('root')).render(<>{location.search.includes('crm=1')?<CrmShellView title='CRM' subtitle='' activeHref='/crm' user={{id:'owner',role:'owner',displayName:'Owner'}} links={[]} avatar=''>{content}</CrmShellView>:<main className='ac-page-copy'><PublicHeader/>{content}</main>}<TeamAssistant/>{location.search.includes('permissions=1')?<div className="crm-root"><form id="permissions-test"><StaffPermissions role="owner" owner/></form></div>:null}</>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'next-fixture',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-fixture'}));b.onLoad({filter:/.*/,namespace:'next-fixture'},args=>({contents:args.path.endsWith('navigation')?`export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>'/cars';export const useRouter=()=>({back(){},replace(){},refresh(){}});`:`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children);}`,loader:'jsx',resolveDir:process.cwd()}));}}],outfile:`${out}/fixture.js`,loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'}});
 const layouts=['apps/web/app/layout.tsx','apps/web/app/(public)/layout.tsx','apps/web/app/(crm)/layout.tsx'];
 const sources=layouts.map(p=>({file:p,text:fs.readFileSync(p,'utf8')}));
 const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
 const inline=sources.flatMap(({text})=>[...text.matchAll(/const (?:publicUiCorrections|publicPageFixes) = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
 const css=await postcss([tailwindcss({content:['apps/web/components/crm/assistant/*.tsx','apps/web/components/crm/CrmShellView.tsx','apps/web/components/home/CitySelector.tsx','apps/web/components/catalog/FavoriteToggle.tsx','apps/web/components/catalog/CatalogBrandMultiSelect.tsx','apps/web/components/catalog/OfferUpdatedStatus.tsx','apps/web/components/catalog/OfferContactActions.tsx','apps/web/components/catalog/ShareLinkButton.tsx','apps/web/components/crm/CrmPushControl.tsx','apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/catalog/RecyclingPower.tsx','tests/browser/owner-polish-fixture.tsx','apps/web/components/crm/CrmLiveAlerts.tsx','apps/web/components/layout/PublicHeader.tsx','apps/web/components/catalog/OfferSpecificationsDisclosure.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
 fs.writeFileSync(`${out}/app.css`,css.css);
 const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark'</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
 server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(name==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}let file=path.join(out,path.basename(name));if(!fs.existsSync(file)){const root=path.resolve('apps/web/public');file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':name.endsWith('.woff2')?'font/woff2':name.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});

try {
 for(const width of [390,899,900,1440]) for(const theme of ['light','dark']) for(const crm of [false,true]) {
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({json:route.request().url().includes('/auth/me')?{user:{id:'owner',role:'owner'}}:route.request().url().includes('/crm/assistant')?{userId:'owner',messages:[],revision:0,connected:false,owner:true}:{counts:{},through:new Date().toISOString(),ok:true,pending:[],recent:[]}}));
  await page.goto(origin+'/?theme='+theme+'&crm='+(crm?'1':'0'));
  const fab=page.getByRole('button',{name:'Открыть ИИ-помощника',exact:true});await fab.waitFor();
  if(width<900){const f=await fab.boundingBox();assert.ok(Math.abs(900-f.y-f.height-12)<2,'launcher hugs bottom');}
  await fab.click();const panel=page.locator('dialog[open]');await panel.waitFor();
  if(width>=900){
   for(const target of [340,640]){
    const grip=page.getByRole('separator');const b=await grip.boundingBox();await page.mouse.move(b.x+b.width/2,200);await page.mouse.down();await page.mouse.move(width-target,200);await page.mouse.up();
    const p=await panel.boundingBox(),h=await page.locator(crm?'.crm-header':'.ac-public-header').boundingBox();assert.ok(h.x+h.width<=p.x+1,'header does not overlap resized assistant');
   }
  }else{
   const p=await panel.boundingBox(),h=await page.locator('.ta-handle').boundingBox();assert.ok(Math.abs(p.y+p.height-900)<2,'sheet hugs bottom');assert.ok(h.y+h.height<=p.y+1,'handle outside sheet');
   assert.equal(await panel.evaluate(e=>getComputedStyle(e,'::backdrop').backdropFilter),'blur(12px)');
   assert.equal(await page.evaluate(()=>document.activeElement?.tagName==='TEXTAREA'),false,'no forced keyboard on opening');
   await page.locator('.ta-header h2').click();assert.equal(await panel.count(),1,'inside tap keeps sheet open');
   await page.mouse.click(20,Math.max(4,p.y-45));assert.equal(await panel.count(),1,'outside tap keeps internal chat open');
   const grip=await page.locator('.ta-handle').boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+16);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2,grip.y+100);await page.mouse.up();await panel.waitFor({state:'detached'});
   assert.equal(await page.evaluate(()=>document.documentElement.style.overflow),'');await fab.click();await panel.waitFor();
  }
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`${out}/${width}-${theme}-${crm?'crm':'public'}.png`});
  await page.getByRole('button',{name:'Закрыть помощника',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.dataset.teamAssistantOpen||''),'');assert.deepEqual(errors,[]);await page.close();console.log(JSON.stringify({width,theme,crm,passed:true}));
 }

 // Exercise connection controls and press-to-talk with a deterministic browser speech service.
 {
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.addInitScript(()=>{
   window.SpeechRecognition=class {start(){window.recognition=this;}stop(){this.onresult({results:[[{transcript:'Найди автомобиль'}]]});this.onend();}abort(){this.onend?.();}};
   window.addEventListener('message',e=>{if(e.data?.source!=='avtocena-assistant-v1')return;const m=e.data;window.postMessage({source:'avtocena-assistant-v1-reply',id:m.id,ok:true,version:'1.0.5',connected:m.op==='connect'},location.origin);});
  });
  await page.route('**/api/**',r=>r.fulfill({json:r.request().url().includes('/auth/me')?{user:{id:'owner',role:'owner'}}:{userId:'owner',messages:[],revision:0,connected:false,owner:true}}));
  await page.goto(origin);await page.getByRole('button',{name:'Открыть ИИ-помощника',exact:true}).click();
  await page.getByRole('button',{name:'Подключить ChatGPT',exact:true}).click();await page.getByText('ChatGPT подключён. Пишите здесь — ответ появится в этом чате.',{exact:true}).waitFor();
  const mic=page.getByRole('button',{name:'Удерживайте для голосового ввода'}),b=await mic.boundingBox(),send=await page.getByRole('button',{name:'Отправить сообщение',exact:true}).boundingBox();assert.equal((await mic.innerText()).trim(),'');assert.ok(Math.abs(b.y-send.y)<2&&b.x<send.x,'icon beside send');
  await page.mouse.move(b.x+20,b.y+15);await page.mouse.down();assert.equal(await mic.getAttribute('aria-pressed'),'true');await page.mouse.up();
  const form=page.locator('.ta-compose form'),height=(await form.boundingBox()).height;
  await page.getByRole('button',{name:'Смайлики',exact:true}).click();await page.getByRole('button',{name:'Вставить 👍',exact:true}).click();
  assert.match(await page.getByRole('textbox',{name:'Сообщение помощнику'}).inputValue(),/👍/);
  await page.getByRole('button',{name:'Вложения и контекст',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Снимок экрана',exact:true}).isVisible());assert.equal((await form.boundingBox()).height,height);
  await page.getByRole('button',{name:'Вложения и контекст',exact:true}).click();await page.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Длинное сообщение\n'.repeat(30));assert.equal((await form.boundingBox()).height,height);
  await page.getByRole('textbox',{name:'Сообщение помощнику'}).fill('Найди автомобиль');
  assert.equal(await page.getByRole('textbox',{name:'Сообщение помощнику'}).inputValue(),'Найди автомобиль');assert.equal(await mic.getAttribute('aria-pressed'),'false');
  const transfer=await page.evaluateHandle(()=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;const bytes=Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bytes],'dragged-photo.png',{type:'image/png'}));return dt;});
  await page.locator('.ta-panel').dispatchEvent('dragover',{dataTransfer:transfer});await page.getByText('Отпустите фото, чтобы прикрепить его',{exact:true}).waitFor();
  await page.locator('.ta-panel').dispatchEvent('drop',{dataTransfer:transfer});await page.locator('.ta-attachments img').waitFor();assert.equal(await page.locator('.ta-attachments img').getAttribute('alt'),'dragged-photo.png');assert.equal((await form.boundingBox()).height,height);assert.equal(await page.locator('.ta-drop-hint').count(),0);await transfer.dispose();
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;return c.toDataURL('image/png').split(',')[1];});
  await page.route('**/test-drag-photo.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from(png,'base64')}));
  await page.evaluate(()=>{const img=document.createElement('img');img.id='drag-source';img.src='/test-drag-photo.png';img.alt='Фото автомобиля со страницы';document.body.append(img);});
  const pageTransfer=await page.evaluateHandle(()=>new DataTransfer());await page.locator('#drag-source').dispatchEvent('dragstart',{dataTransfer:pageTransfer});await page.locator('.ta-panel').dispatchEvent('drop',{dataTransfer:pageTransfer});await pageTransfer.dispose();await page.waitForFunction(()=>document.querySelectorAll('.ta-attachments img').length===2,null,{timeout:5000}).catch(async e=>{console.log('DROP ERROR',await page.locator('.ta-error').allTextContents());throw e;});assert.equal(await page.locator('.ta-attachments img').nth(1).getAttribute('alt'),'Фото автомобиля со страницы');assert.equal((await form.boundingBox()).height,height);

  await page.screenshot({path:out+'/voice-connected-mobile.png'});await page.close();console.log('connection and voice hold/release passed');
 }
 {
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.route('**/api/**',r=>r.fulfill({status:403,json:{error:'disabled'}}));await page.goto(origin+'/?permissions=1');
  const controls=page.locator('#permissions-test'),toggle=controls.getByRole('switch',{name:'ИИ Бро',exact:false});await toggle.waitFor();
  assert.equal(await controls.locator('input').first().getAttribute('name'),'permission_assistant');assert.equal(await toggle.isChecked(),true);assert.equal(await toggle.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(5, 150, 105)');
  await toggle.uncheck();assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#permissions-test')).has('permission_assistant')),false);await toggle.check();assert.equal(await page.evaluate(()=>new FormData(document.querySelector('#permissions-test')).get('permission_assistant')),'on');
  assert.equal(await page.locator('.ta-fab').count(),0);await page.screenshot({path:out+'/permissions-switch.png'});await page.close();console.log('top green assistant switch and disabled launcher passed');
 }
 // The real extension content script must ignore old answers and reject a changed conversation.
 {
  const page=await browser.newPage();await page.goto(origin);
  await page.setContent('<main><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button></main>');
  await page.evaluate(()=>{window.chrome={runtime:{id:'test-extension',onMessage:{addListener(fn){window.bridgeListener=fn;}}}};document.querySelector('button').onclick=()=>{const u=document.createElement('div');u.dataset.messageAuthorRole='user';u.textContent=document.querySelector('textarea').value;document.querySelector('main').append(u);const a=document.createElement('div');a.dataset.messageAuthorRole='assistant';a.textContent='{"reply":"Только новый ответ"}';document.querySelector('main').append(a);};});
  await page.addScriptTag({content:fs.readFileSync('apps/web/public/assistant-connector/chatgpt.js','utf8')});
  const rpc=m=>page.evaluate(m=>new Promise(resolve=>window.bridgeListener(m,{id:'test-extension'},resolve)),m);
  assert.equal((await rpc({op:'bind',binding:'one'})).ok,true);await page.evaluate(()=>{const old=document.createElement('div');old.dataset.messageAuthorRole='assistant';old.textContent='OLD PRIVATE ANSWER';document.querySelector('main').prepend(old);});
  const response=await rpc({op:'send',binding:'one',requestId:'unique-request',input:[{role:'user',content:'hello'}]});assert.equal(response.text,'{"reply":"Только новый ответ"}');
  await page.evaluate(()=>history.pushState({},'','/c/another'));assert.equal((await rpc({op:'send',binding:'one',requestId:'next',input:[]})).ok,false);
  await page.close();console.log('extension new-answer isolation and changed-route guard passed');
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
