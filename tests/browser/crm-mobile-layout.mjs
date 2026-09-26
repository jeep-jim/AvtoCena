import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import PDFDocument from 'pdfkit';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const testPdf=await new Promise(resolve=>{const doc=new PDFDocument(),parts=[];doc.on('data',part=>parts.push(part));doc.on('end',()=>resolve(Buffer.concat(parts)));doc.text('CRM test document');doc.end();});
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const out='artifacts/crm-mobile';fs.mkdirSync(out,{recursive:true});
const pdfRoot=path.dirname(require.resolve('pdfjs-dist/package.json')),pdfVersion=require('pdfjs-dist/package.json').version;
const pdfAssets=path.join(out,'pdfjs',pdfVersion);fs.mkdirSync(pdfAssets,{recursive:true});
fs.copyFileSync(path.join(pdfRoot,'legacy/build/pdf.worker.min.mjs'),path.join(pdfAssets,'pdf.worker.min.mjs'));
for(const dir of ['cmaps','standard_fonts','wasm'])fs.cpSync(path.join(pdfRoot,dir),path.join(pdfAssets,dir),{recursive:true});
const mock=path.resolve('tests/browser/crm-mobile-mocks.ts');
await build({entryPoints:['tests/browser/crm-mobile-fixture.tsx'],bundle:true,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',outfile:out+'/fixture.js',loader:{'.module.css':'local-css'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-services',setup(b){
 b.onResolve({filter:/^@\/lib\/(auth|data|crm-users|business-settings|avtocena|effective-market-settings|crm-notifications|crm-read-state|catalog\/customs-pricing|catalog\/estimated-market-config)$/},()=>({path:mock}));
 b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'next-test'}));
 b.onLoad({filter:/.*/,namespace:'next-test'},args=>({contents:args.path.endsWith('navigation')?`export const redirect=()=>{throw Error('redirect')};export const notFound=()=>{throw Error('notFound')};export const usePathname=()=>'/crm';export const useRouter=()=>({refresh(){},push(){}});`:`import React from 'react';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children);}`,loader:'jsx',resolveDir:process.cwd()}));
}}]});
const layouts=['apps/web/app/layout.tsx','apps/web/app/(crm)/layout.tsx'];
const sources=layouts.map(file=>({file,text:fs.readFileSync(file,'utf8')}));
const imports=sources.flatMap(({file,text})=>[...text.matchAll(/import\s+["'](\.[^"']+\.css)["']/g)].map(m=>path.resolve(path.dirname(file),m[1])));
const inline=sources.flatMap(({text})=>[...text.matchAll(/const publicUiCorrections = `([\s\S]*?)`;/g)].map(m=>m[1])).join('\n');
const css=await postcss([tailwindcss({content:['apps/web/components/crm/**/*.{tsx,ts}','apps/web/app/(crm)/**/*.tsx','apps/web/components/leads/PhoneInput.tsx']}),autoprefixer]).process(imports.map(p=>fs.readFileSync(p,'utf8')).join('\n')+'\n'+inline,{from:'apps/web/app/globals.css'});
fs.writeFileSync(out+'/app.css',css.css);
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><script>document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'dark';localStorage.setItem('avtocena_theme',document.documentElement.dataset.theme)</script><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`;
const server=http.createServer((req,res)=>{const name=(req.url||'/').split('?')[0];if(['/', '/crm/clients', '/crm/leads'].includes(name)){res.setHeader('content-type','text/html');res.end(html);return;}let file=path.join(out,path.basename(name));if(!fs.existsSync(file)){const root=path.resolve(name.startsWith('/pdfjs/')?out:'apps/web/public');file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('content-type',name.endsWith('.css')?'text/css':(/\.m?js$/).test(name)?'text/javascript':name.endsWith('.webp')?'image/webp':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'application/octet-stream');res.end(fs.readFileSync(file));}else{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[],failures=[];
try{
 for(const theme of ['dark','light'])for(const width of [320,390,768,1440])for(const kind of (process.env.CRM_TEST_PAGES?.split(',')||['overview','leads','team','settings','clients','client','archive','documents','staff'])){
  const page=await browser.newPage({viewport:{width,height:850},isMobile:width<768,hasTouch:width<768});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',r=>r.request().url().endsWith('/presence')?r.fulfill({json:{team:[{id:'owner-test',displayName:'Тестовый руководитель',online:true},{id:'manager-test',displayName:'Александр Константинопольский',online:false}]}}):r.request().method()==='PATCH'?r.fulfill({json:{ok:true}}):r.request().url().includes('/documents/22222222-2222-4222-8222-222222222222')?r.fulfill({contentType:'application/pdf',body:testPdf}):r.request().url().includes('/documents/')?r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=','base64')}):r.fulfill({json:{ok:true,leads:[],readReceipts:[],state:{eventKey:'test'}}}));
   let reminders=[];
   await page.route('**/api/crm/activity**',r=>r.fulfill({json:{userId:'owner-test',events:[{id:'evt-assigned',createdAt:'2026-09-26T07:00:00Z',type:'lead_assigned',title:'Назначен менеджер заявки',actor:{id:'owner-test',name:'Тестовый руководитель'},target:{id:'manager-test',name:'Александр Константинопольский'},entityLabel:'Toyota Corolla Cross',href:'/crm/leads?id=test-0',changes:[{label:'Ответственный',before:'Не назначен',after:'Александр Константинопольский'}]}]}}));
   await page.route('**/api/crm/reminders**',async r=>{if(r.request().method()==='POST'){const b=r.request().postDataJSON();if(b.action==='done')reminders=reminders.filter(x=>x.id!==b.id);else reminders.push({...b,id:'reminder-1',ownerId:'owner-test',entityLabel:'Клиент для проверки',createdAt:new Date().toISOString()});await r.fulfill({json:{ok:true}});}else await r.fulfill({json:{reminders}});});
   if(kind==='documents'){
   const template=JSON.parse(fs.readFileSync('apps/web/lib/contracts/default-templates.json','utf8'))[0];let record=null;let records=[];
   await page.route('**/api/crm/contracts**',async route=>{const req=route.request(),url=new URL(req.url());if(req.method()==='GET'){await route.fulfill({json:url.searchParams.has('template')?{template}:url.searchParams.has('id')?{record}:{records}});return;}const body=req.postDataJSON();if(body.action==='create')record={id:body.id,number:'24.09/01',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:'owner-test',clientId:'',fields:{date:'2026-09-24',market:'japan',deliveryDays:'90'},template,calculation:null,versions:[]};else if(body.action==='save')record={...record,number:body.number??record.number,fields:body.fields,clientId:body.clientId,template:body.template,revision:record.revision+1};else if(body.action==='archive')record={...record,archivedAt:new Date().toISOString(),revision:record.revision+1};else if(body.action==='restore')record={...record,archivedAt:undefined,revision:record.revision+1};else if(body.action==='purge')record=null;else if(body.action==='template'){await route.fulfill({json:{template:{...body.template,revision:body.revision+1}}});return;}records=record?[...records.filter(x=>x.id!==record.id),{...record,client:record.fields.fio||'Без клиента',car:record.fields.car||'',market:record.fields.market,templateId:record.template.id,versions:record.versions.length}]:[];await route.fulfill({json:{record,ok:true}});});
  }
  try{
   await page.goto(`http://127.0.0.1:${server.address().port}/?kind=${kind}&theme=${theme}`);
   await page.locator('.crm-content').waitFor();
   assert.equal(await page.locator('.crm-header .ac-staff-leads').count(),0,'no duplicated requests shortcut');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no page overflow');
   if(width<=390)assert.ok(await page.locator('.crm-header').evaluate(e=>e.getBoundingClientRect().height)<155,'compact header');
   await page.getByRole('button',{name:'Кабинет сотрудника'}).click();
   assert.ok(await page.getByRole('link',{name:'Мой профиль',exact:true}).isVisible());
   assert.equal(await page.locator('.ac-staff-menu a[href="/crm/leads"]').count(),0);
   await page.keyboard.press('Escape');assert.equal(await page.locator('.ac-staff-menu').isVisible(),false,'Escape closes the menu while notification state stays mounted');
   if(kind==='overview'){
    await page.getByText('Назначен менеджер заявки',{exact:true}).waitFor();
    const event=page.locator('.crm-event').first();await event.locator('summary').click();assert.ok(await event.getByText('Ответственный',{exact:true}).isVisible());
    const boxes=await page.locator('.crm-quick-actions>a').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));assert.ok(boxes[1].y>=boxes[0].y+boxes[0].height);assert.equal(boxes[1].y,boxes[2].y);
   }
   if(kind==='clients'){
    await page.getByRole('button',{name:'Плитки клиентов',exact:true}).click();assert.ok(await page.locator('.crm-clients-grid').isVisible());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    if(width>=768)assert.equal(await page.locator('.crm-clients-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
    await page.reload();await page.locator('.crm-clients-grid').waitFor();
   }
   if(kind==='client'){
    await page.getByRole('button',{name:'Напоминание',exact:true}).click();
    await page.getByLabel('Дата и время',{exact:true}).fill('2027-01-10T15:30');await page.getByLabel('Что сделать',{exact:true}).fill('Позвонить клиенту');
    await page.getByRole('button',{name:'Добавить напоминание',exact:true}).click();await page.locator('.crm-reminder-editor').getByText('Позвонить клиенту',{exact:true}).waitFor();
    assert.equal(reminders[0].dueAt,'2027-01-10T08:30:00.000Z');
    await page.getByRole('button',{name:'Напоминания: 1',exact:true}).click();await page.locator('.crm-reminder-popover').getByText('Позвонить клиенту',{exact:true}).waitFor();
    await page.locator('.crm-reminder-popover').getByRole('button',{name:'Напоминание выполнено',exact:true}).click();await page.getByRole('button',{name:'Напоминания: 0',exact:true}).waitFor();
    await page.getByRole('button',{name:'Закрыть напоминания',exact:true}).click();
   }
   if(kind==='staff'){
    assert.equal(await page.getByRole('switch').count(),10);assert.equal(await page.getByRole('switch',{name:/Управление сотрудниками/}).isDisabled(),true);
    await page.getByLabel('Роль',{exact:true}).selectOption('admin');assert.equal(await page.getByRole('switch',{name:/Управление сотрудниками/}).isDisabled(),false);
    await page.getByRole('switch',{name:/Документы и договоры/}).uncheck();assert.equal(await page.getByRole('switch',{name:/Документы и договоры/}).isChecked(),false);
   }
   if(kind==='overview'&&width<=390){const boxes=await page.locator('.crm-metrics>div').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));assert.equal(boxes[0].y,boxes[1].y);assert.ok(boxes[2].y>boxes[0].y);}
   if(['clients','client','leads'].includes(kind)){assert.ok(await page.locator('.crm-manual-client-origin').count()>0,'manual origin is shown');if(kind==='leads')assert.ok((await page.locator('.crm-manual-client-origin').first().innerText()).includes('Уже был в базе'));if(kind==='clients'&&(width===390||width===1440)){await page.locator('.crm-manual-client-origin').first().scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/manual-origin-${theme}-${width}.png`});}}
   if(kind==='documents'){
    assert.equal(await page.getByRole('button',{name:'Договоры',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Создать договор',exact:true}).count(),1);
    if(theme==='light')assert.equal(await page.locator('.crm-documents-button').evaluate(e=>getComputedStyle(e).webkitTextFillColor),'rgb(23, 28, 36)','active documents text remains dark');
    assert.ok(await page.getByRole('combobox',{name:'Менеджер',exact:true}).isVisible());
    await page.getByRole('button',{name:'Страна договора: Япония',exact:true}).click();assert.equal(await page.locator('.contract-market-menu svg').count(),6);await page.getByRole('button',{name:'Китай',exact:true}).click();assert.equal(await page.locator('.contract-country svg').count(),2);const flagBox=await page.locator('.contract-country svg[role=img]').boundingBox();assert.equal(flagBox.width,24);assert.equal(flagBox.height,17);await page.getByRole('button',{name:'Страна договора: Китай',exact:true}).click();await page.getByRole('button',{name:'Япония',exact:true}).click();await page.getByRole('button',{name:'Создать договор',exact:true}).click();await page.locator('.contract-editor-layout').waitFor();await page.getByLabel('Номер договора',{exact:true}).fill('TEST/99');assert.ok((await page.locator('.contract-paper').innerText()).includes('TEST/99'));assert.equal(await page.locator('.contract-paper small').count(),0);
    await page.getByLabel('ФИО',{exact:false}).fill('Иванов Иван Иванович');
    await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
    if(width<768){assert.equal(await page.locator('.contract-preview').isVisible(),false);await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();assert.ok(await page.locator('.contract-preview').isVisible());}
    await page.locator('.contract-paper span').filter({hasText:/^Иванов Иван Иванович$/}).first().click();
    await page.waitForFunction(()=>document.activeElement?.closest('[data-editor-field]')?.getAttribute('data-editor-field')==='fio');
    assert.ok(await page.getByLabel('ФИО',{exact:false}).evaluate(e=>e===document.activeElement),'preview click focuses matching field');
    await page.locator('.contract-fields summary').filter({hasText:/^Автомобиль$/}).click();
    await page.getByLabel('Марка, модель, комплектация',{exact:false}).fill('Audi A4L');
    if(width<768)await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.contract-highlight')?.textContent?.includes('Audi A4L'));
    assert.ok(await page.locator('.contract-paper .contract-highlight').filter({hasText:'Audi A4L'}).isVisible(),'focused car highlights preview');
    await page.waitForFunction(()=>{const paper=document.querySelector('.contract-paper'),target=paper?.querySelector('.contract-highlight');if(!target)return false;const p=paper.getBoundingClientRect(),t=target.getBoundingClientRect();return t.top>=p.top&&t.bottom<=p.bottom;});
    if(width>=768){const box=await page.locator('.contract-preview').boundingBox();assert.ok(box.y+box.height<=851,'preview fits viewport');}
    if(width===390||width===1440)await page.screenshot({path:`${out}/contract-editor-${theme}-${width}.png`});
    await page.getByRole('button',{name:'← К списку',exact:true}).click();await page.locator('.contract-list-row').waitFor();
    page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'В архив договор TEST/99',exact:true}).click();assert.equal(await page.locator('.contract-list-row').count(),1,'cancel archive retains document');
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'В архив договор TEST/99',exact:true}).click();await page.getByRole('button',{name:'Архив',exact:true}).click();await page.getByRole('button',{name:'Восстановить договор TEST/99',exact:true}).waitFor();
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Восстановить договор TEST/99',exact:true}).click();await page.getByRole('button',{name:'Архив',exact:true}).click();await page.locator('.contract-list-row').waitFor();
    if(width===1440){await page.getByRole('button',{name:'Редактировать шаблон',exact:true}).click();await page.locator('.contract-editor-layout').waitFor();assert.ok(await page.locator('.contract-paper').isVisible());await page.getByRole('button',{name:'← К списку',exact:true}).click();}
   }
   if(kind==='documents'){
    for(let i=0;i<5;i++){await page.getByRole('button',{name:'Создать договор',exact:true}).click();await page.getByRole('button',{name:'← К списку',exact:true}).click();}
    await page.locator('.contract-list-row').nth(5).waitFor();
    await page.getByRole('button',{name:'Плитки',exact:true}).click();
    const columns=await page.locator('.contract-list-tiles').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
    assert.equal(columns,width>=1100?3:width>=768?2:1);
    await page.getByPlaceholder('Клиент, автомобиль или номер').fill('TEST/99');assert.equal(await page.locator('.contract-list-row').count(),1);
    await page.getByRole('button',{name:'Список',exact:true}).click();assert.equal(await page.locator('.contract-list-row').count(),1);
    await page.getByRole('button',{name:'Плитки',exact:true}).click();await page.getByRole('button',{name:'Сбросить',exact:true}).click();
    await page.reload();await page.locator('.contract-list-tiles .contract-list-row').nth(5).waitFor();
    if(width===390||width===1440){await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${out}/document-tiles-${theme}-${width}.png`});}
    if(width>=1100){const archive=await page.getByRole('button',{name:'Архив',exact:true}).boundingBox(),date=await page.locator('.contract-filters .crm-date-control').boundingBox();assert.ok(archive.x>=date.x+date.width,'archive is right of date');}
   }
   if(kind==='leads'){
    const clientLink=page.locator('.crm-lead-client-link').first();assert.equal(await clientLink.getAttribute('href'),'/crm/clients/client-0');
    await page.getByRole('button',{name:'+ Создать заявку',exact:true}).click();
    const close=page.getByRole('button',{name:'Закрыть форму',exact:true});assert.ok(await close.locator('span').isVisible());
    assert.ok(await close.evaluate(e=>getComputedStyle(e).backgroundColor!==getComputedStyle(document.querySelector('button[type=submit]')).backgroundColor));
    await page.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.getByPlaceholder('Имя клиента *').isVisible(),false);
    await page.getByRole('button',{name:'+ Создать заявку',exact:true}).click();await close.click();assert.equal(await page.getByPlaceholder('Имя клиента *').isVisible(),false);
    assert.equal(await page.locator('.crm-date-display').textContent(),'дд.мм.гггг');
    assert.ok(await page.locator('.crm-date-control>svg').isVisible(),'consistent calendar icon');
    await page.locator('#lead-date').evaluate(e=>{e.showPicker=()=>{window.__crmPickerOpened=true;}});await page.locator('#lead-date').click();assert.ok(await page.evaluate(()=>window.__crmPickerOpened),'tap opens native calendar');
    const dateBoxes=await page.locator('.crm-lead-date-filter').evaluate(e=>[e.querySelector('label'),e.querySelector('input[type=date]'),e.querySelector('button')].map(n=>{const r=n.getBoundingClientRect();return r.y+r.height/2}));assert.ok(Math.max(...dateBoxes)-Math.min(...dateBoxes)<2,'date controls on one row');
    if(width<768){for(const card of await page.locator('.crm-lead-summary').all()){const manager=await card.locator('.crm-lead-manager').boundingBox(),status=await card.locator('.crm-lead-status>span').boundingBox();assert.ok(manager.y>=status.y+status.height,'manager has its own row below status');assert.ok(manager.width>240,'manager uses full card width');}}
    if(width<=390){const height=await page.locator('.crm-lead-summary').first().evaluate(e=>e.getBoundingClientRect().height);assert.ok(height<265,`lead summary is compact (${height}px)`);}
    for(const summary of await page.locator('.crm-lead-summary').all()){assert.ok(await summary.locator('.crm-lead-channel-icon').isVisible(),'channel icons on desktop and mobile');assert.equal(await summary.locator('.crm-contact-text').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','no contact badge background');}
    assert.ok(await page.locator('.crm-phone-icon').first().isVisible(),'modern handset icon');
    if(width<768){const summary=page.locator('.crm-lead-summary').first();const icon=await summary.locator('.crm-lead-channel-icon').boundingBox(),car=await summary.locator('.crm-lead-car-image').boundingBox();assert.equal(icon.x,car.x,'channel and car images aligned');assert.ok(car.y>icon.y);assert.ok(await summary.locator('.crm-lead-channel-icon img').evaluate(img=>img.complete&&img.naturalWidth===80),'Figma asset loaded');}
    await page.locator('.crm-lead-summary').first().click();assert.ok(await page.getByRole('combobox',{name:'Статус заявки',exact:true}).first().isVisible());
    const chat=page.locator('.crm-contact-action').first();assert.equal(await chat.getAttribute('href'),'https://t.me/+79991234567');
    await page.context().route('https://t.me/**',r=>r.fulfill({contentType:'text/html',body:'Telegram link test'}));
    const opened=page.waitForEvent('popup');await chat.click();const popup=await opened;await popup.waitForLoadState();assert.equal(popup.url(),'https://t.me/+79991234567');await popup.close();
    if(width===390||width===1440){
     await page.locator('.crm-lead-card').first().evaluate(e=>e.open=false);
     await page.locator('.crm-lead-date-filter').evaluate(e=>window.scrollBy(0,e.getBoundingClientRect().top-180));
     await page.screenshot({path:`${out}/contact-summary-${theme}-${width}.png`});
    }
   }
   if(kind==='clients'){
    assert.equal(await page.locator('.crm-client-card>div:first-child .crm-manual-client-origin').count(),0);
    assert.ok(await page.locator('.crm-client-owner .crm-client-origin-compact svg').count()>0);
    assert.ok(await page.locator('.crm-client-owner .crm-client-assigned svg').count()>0);
    if(width>=1024){
     await page.evaluate(()=>window.scrollTo(0,200));await page.waitForTimeout(150);const y1=(await page.locator('.crm-client-create').boundingBox()).y;
     await page.evaluate(()=>window.scrollTo(0,300));await page.waitForTimeout(150);const y2=(await page.locator('.crm-client-create').boundingBox()).y;
     assert.ok(Math.abs(y2-y1)<2,'desktop sidebar stays fixed while list scrolls');
     const header=await page.locator('.crm-header').boundingBox();assert.ok(y2>=header.y+header.height,'sidebar stays below sticky header');
     await page.locator('.crm-client-create').evaluate(e=>e.scrollTop=e.scrollHeight);const button=await page.getByRole('button',{name:'Добавить клиента',exact:true}).boundingBox();assert.ok(button.y+button.height<=851,'sidebar submit stays reachable');
     await page.locator('.crm-client-create').evaluate(e=>e.scrollTop=0);
    }
   }
   if(kind==='client'){
    assert.ok(await page.getByRole('button',{name:'Прикрепить файлы'}).isVisible());
    assert.equal(await page.locator('.crm-client-file').count(),2);
    if(width<768){const files=await page.locator('.crm-client-file').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));assert.equal(files[0].y,files[1].y,'two document columns');}
    if(width===1440){const form=await page.locator('.crm-client-detail-layout>form').boundingBox(),docs=await page.locator('.crm-client-files').boundingBox();assert.ok(docs.x>form.x+form.width,'documents right of client form');assert.equal(Math.round(docs.y),Math.round(form.y));}
    let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});
    page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Удалить Паспорт.png',exact:true}).click();assert.equal(patches,0,'cancel does not delete');
    page.once('dialog',d=>{assert.match(d.message(),/30 дней/);return d.accept();});await page.getByRole('button',{name:'Удалить Паспорт.png',exact:true}).click();await page.getByRole('status').filter({hasText:'Документ в корзине'}).waitFor();assert.equal(patches,1);
    await page.getByRole('button',{name:'Просмотреть Паспорт.png'}).click();
    assert.ok(await page.getByRole('dialog',{name:'Просмотр документа'}).isVisible());
    await page.getByRole('button',{name:'Закрыть просмотр'}).click();
    await page.getByRole('button',{name:'Просмотреть Договор.pdf'}).click();
    await page.locator('[data-pdf-page="1"] canvas').waitFor();
    await page.getByRole('button',{name:'Закрыть предпросмотр',exact:true}).click();
    await page.locator('input[type=file]').setInputFiles({name:'Договор.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
    await page.getByRole('status').filter({hasText:'Сохранено файлов: 1.'}).waitFor();
   }
   if(kind==='archive'){
    assert.ok(await page.getByRole('heading',{name:'Корзина документов'}).isVisible());
    let patches=0;page.on('request',r=>{if(r.method()==='PATCH')patches++;});
    page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Удалить навсегда',exact:true}).click();assert.equal(patches,0);
    await page.getByRole('button',{name:'Восстановить',exact:true}).click();await page.getByRole('status').filter({hasText:'Документ восстановлен'}).waitFor();assert.equal(patches,1);
    page.once('dialog',d=>{assert.match(d.message(),/навсегда/);return d.accept();});await page.getByRole('button',{name:'Очистить корзину (1)',exact:true}).click();await page.getByRole('status').filter({hasText:'Удалено файлов: 1'}).waitFor();assert.equal(patches,2);
   }
   if(kind==='overview'){
    await page.locator('.crm-presence-card').first().waitFor();
    for(const selector of ['.crm-presence-card','.crm-overview-feed>a'])assert.ok(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).backgroundColor!==getComputedStyle(e.parentElement.closest('section')||e.parentElement).backgroundColor),'distinct card background');
   }
   if(kind==='settings'){
    const title=await page.getByRole('heading',{name:'Все рынки',exact:true}).boundingBox(),chip=await page.locator('.crm-market-count').boundingBox(),help=await page.locator('.crm-markets-help').boundingBox();assert.ok(Math.abs((title.y+title.height/2)-(chip.y+chip.height/2))<3,'market count at top right');
    if(width>=768)assert.ok(Math.abs((title.y+title.height/2)-(help.y+help.height/2))<3,'desktop help beside title');
    assert.equal(await page.locator('.crm-markets-heading>p').isVisible(),false);await page.locator('.crm-markets-summary').click();assert.ok(await page.locator('.crm-markets-heading>p').isVisible());await page.locator('.crm-markets-summary').click();
    if(width===390||width===1440)await page.locator('.crm-markets-heading').screenshot({path:`${out}/market-heading-${theme}-${width}.png`});
    assert.equal(await page.locator('.crm-calculator-disclosure').getAttribute('open'),null);
    await page.locator('.crm-calculator-disclosure>summary').click();
    assert.equal(await page.locator('select[name="calcPowertrain"]').isVisible(),true);
    const calcDate=page.locator('input[name="calcDate"]');assert.equal(await calcDate.evaluate(e=>getComputedStyle(e).opacity),'0','native date arrow invisible');assert.equal(await calcDate.locator('..').locator('svg').count(),0,'no decorative arrow in calculation date');
    await calcDate.fill('2026-10-01');assert.equal(await calcDate.locator('..').locator('.crm-date-display').textContent(),'01.10.2026');
    if(width===390||width===1440)await calcDate.locator('..').screenshot({path:`${out}/calculation-date-${theme}-${width}.png`});
    const fields=await page.locator('.crm-calculation-fields>label').evaluateAll(els=>els.slice(0,2).map(e=>e.getBoundingClientRect().toJSON()));assert.equal(fields[0].y,fields[1].y);
    assert.equal(await page.locator('form[action="/api/crm/settings/markets"]').count(),6,'all six market forms retained');
   }
   if(kind==='clients'){
    if(width<768){assert.equal(await page.getByPlaceholder('ФИО клиента').isVisible(),false,'mobile form initially collapsed');await page.locator('.crm-client-create-toggle').click();assert.ok(await page.getByPlaceholder('ФИО клиента').isVisible());await page.locator('.crm-client-create-toggle').click();assert.equal(await page.locator('.crm-client-avatar').count(),0,'no client initials');}else assert.ok(await page.getByPlaceholder('ФИО клиента').isVisible(),'desktop form expanded');
    assert.ok(await page.getByRole('textbox',{name:'Поиск клиентов'}).isVisible());
    assert.ok(await page.locator('.crm-client-card').count()>0);
    if(width===1440){const list=await page.locator('.crm-clients-list').boundingBox(),form=await page.locator('.crm-client-create').boundingBox();assert.ok(form.x>list.x+list.width,'create form on the right');}
   }
   assert.ok(await page.locator('.crm-brand small').isVisible(),'CRM visible on mobile and desktop');
   assert.equal(await page.locator('.crm-brand-mark').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)','no white logo background');
   for(const select of await page.locator('select:visible').all()){assert.ok(['right 16px center','right 16px 50%','calc(100% - 16px) 50%'].includes(await select.evaluate(e=>getComputedStyle(e).backgroundPosition)),await select.evaluate(e=>e.outerHTML+' POSITION='+getComputedStyle(e).backgroundPosition));assert.ok(await select.evaluate(e=>parseFloat(getComputedStyle(e).paddingRight)>=40));}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no overflow after disclosure');
   if(width===390||width===1440)await page.screenshot({path:`${out}/${kind}-${theme}-${width}.png`,fullPage:false});
   await page.mouse.move(width-4,400);await page.mouse.wheel(0,500);await page.waitForTimeout(150);
   assert.ok(await page.locator('.crm-header').evaluate(e=>Math.abs(e.getBoundingClientRect().top)<1),'header remains at top');
   if(kind==='clients'&&theme==='light'&&width===390){
    await page.getByRole('textbox',{name:'Поиск клиентов'}).fill('проверки 3');
    await page.getByRole('button',{name:'Найти',exact:true}).click();
    await page.waitForURL('**/crm/clients?q=*');
    await page.locator('.crm-client-card').first().waitFor();
    assert.equal(await page.locator('.crm-client-card').count(),1,'client search filters results');
   }
   if(kind==='leads'&&theme==='light'&&width===390){
    await page.locator('#lead-date').fill('2026-09-22');
    await page.getByRole('button',{name:'Показать',exact:true}).click();
    await page.waitForURL('**/crm/leads?**date=2026-09-22');
    await page.locator('#lead-date').waitFor();
    assert.equal(await page.locator('.crm-lead-card').count(),0,'date filter excludes other days');
    await page.getByRole('button',{name:'Очистить',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('date'));await page.locator('.crm-lead-card').first().waitFor();assert.equal(await page.locator('#lead-date').inputValue(),'');
   }
   assert.deepEqual(errors,[]);results.push({kind,width,theme,passed:true});
  }catch(e){fs.writeFileSync(`${out}/failure-${kind}-${theme}-${width}.json`,JSON.stringify({kind,width,theme,error:String(e),errors},null,2));await page.screenshot({path:`${out}/failure-${kind}-${theme}-${width}.png`,fullPage:true}).catch(()=>{});failures.push({kind,width,theme,error:String(e),errors});}finally{await page.close();}
 }
 fs.writeFileSync(out+'/results.json',JSON.stringify({results,failures},null,2));assert.deepEqual(failures,[]);console.log(JSON.stringify({cases:results.length,passed:true}));
}finally{await browser.close();server.close();}
