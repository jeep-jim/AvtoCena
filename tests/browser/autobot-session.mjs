import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||createRequire(import.meta.url).resolve('playwright'));
const out='/tmp/avtocena-autobot-session';fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Autobot} from './apps/web/components/autobot/Autobot';createRoot(document.getElementById('root')).render(<Autobot/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,external:['/autobot/*'],platform:'browser',jsx:'automatic',outfile:out+'/app.js',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children);}`:`export const usePathname=()=>location.pathname;export const useRouter=()=>({push:()=>{},back:()=>{},refresh:()=>{}});`}));}}]});
const utilities=await postcss([tailwindcss({content:['apps/web/components/autocalc/AutoCalcPage.tsx','apps/web/components/home/CitySelector.tsx','apps/web/components/catalog/InlineOfferParameters.tsx','apps/web/components/autocalc/KnowledgeSuggestions.tsx']}),autoprefixer]).process('@tailwind base;@tailwind components;@tailwind utilities;:root{--ac-surface:#202b38;--ac-surface-2:#2c3849;--ac-border:#ffffff22;--ac-text:#fff;--ac-muted:#abb5c3}',{from:undefined});
fs.writeFileSync(out+'/app.css',utilities.css+'\n'+fs.readFileSync(out+'/app.css','utf8'));
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext();let sent;let sendCount=0;let formMode=false;let calculationBody;
 const formSeed={make:'Honda',model:'Fit',market:'japan',currency:'RUB',price:'1000',city:'Кемерово',draft:{year:'2023',productionMonth:'6',fuel:'petrol',engineCc:'1496',powerHp:'110',vehicleCategory:'M1'}};
 await context.route('https://autobot.test/**',route=>{const u=new URL(route.request().url());
 if(u.pathname==='/api/autobot'){if(route.request().method()==='POST'){sendCount++;sent=route.request().postDataJSON();return route.fulfill({json:{text:'Город — Омск.',cards:[],sources:[{title:'Лишний источник',url:'https://unrequested.test/source'}]}});}return route.fulfill({json:{connected:true}});}
 if(u.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{}});
 if(u.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(out+'/app.js','utf8')});
 if(u.pathname==='/app.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(out+'/app.css','utf8')});
 return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'});});
 const page=await context.newPage();await page.goto('https://autobot.test/cars');await page.getByRole('button',{name:'Открыть АвтоБота',exact:true}).click();
 await page.getByLabel('Сообщение АвтоБоту').fill('Мой город Омск');await page.getByRole('button',{name:'Отправить вопрос'}).click();await page.getByText('Город — Омск.',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Лишний источник'}).count(),0);
 await page.getByLabel('Сообщение АвтоБоту').fill('Сколько стоит');await page.reload();await page.getByText('Город — Омск.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Сообщение АвтоБоту').inputValue(),'Сколько стоит');
 await page.getByRole('button',{name:'Отправить вопрос'}).click();await page.getByRole('button',{name:'Отправить вопрос'}).waitFor();assert.ok(sent.history.some(m=>m.text==='Мой город Омск'));
 await page.getByRole('button',{name:'Настройки АвтоБота',exact:true}).click();await page.getByRole('button',{name:'Новый чат',exact:true}).click();assert.equal(await page.getByText('Город — Омск.',{exact:true}).count(),0);await page.reload();assert.equal(await page.getByText('Город — Омск.',{exact:true}).count(),0);
 await page.close();const fresh=await context.newPage();await fresh.goto('https://autobot.test/cars');assert.equal(await fresh.evaluate(()=>sessionStorage.getItem('avtocena.autobot.tab.v1')?.includes('Омск')||false),false);
 // A card offers four direct questions; used questions stay consumed after reload.
 await fresh.goto('https://autobot.test/cars/offer/test-car');await fresh.getByRole('button',{name:'Открыть АвтоБота',exact:true}).click();
 const questions=fresh.getByRole('group',{name:'Вопросы об этом автомобиле'});
 await fresh.getByRole('button',{name:'Найди параметры этого автомобиля'}).click();
 await fresh.getByRole('button',{name:'Отправить вопрос'}).waitFor();
 assert.equal(await fresh.getByRole('button',{name:'Найди параметры этого автомобиля'}).count(),0);
 assert.equal(await fresh.locator('.ab-car-questions button').count(),3);assert.equal(await fresh.locator('.ab-car-questions button svg').count(),0);assert.equal(await fresh.locator('.ab-car-questions button').last().evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement.getBoundingClientRect().width)<1),true);assert.equal(await fresh.locator('.ab-car-questions button').first().evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
 await fresh.reload();await fresh.locator('.ab-car-questions').waitFor();assert.equal(await fresh.locator('.ab-car-questions button').count(),3);
 // A touch click must send exactly once and release the keyboard focus.
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.route('https://autobot.test/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/autobot'){if(route.request().method()==='POST'){sendCount++;return route.fulfill({json:{...(formMode?{text:'Заполните форму',calculationForm:formSeed}:{text:'Ответ на первое нажатие'}),cards:[],sources:[]}});}return route.fulfill({json:{connected:true}});}
  if(u.pathname==='/api/autocalc'){calculationBody=route.request().postDataJSON();return route.fulfill({json:{totalRub:1234567,rateDate:'2026-10-19',breakdown:[{title:'Автомобиль',amountRub:1000}],warnings:[]}});}
  if(u.pathname==='/api/autocalc/knowledge')return route.fulfill({json:{models:[],choices:[]}});
  if(u.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{}});
  if(u.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(out+'/app.js','utf8')});
  if(u.pathname==='/app.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(out+'/app.css','utf8')});
  return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'});
 });
 const phone=await mobile.newPage();await phone.goto('https://autobot.test/cars/offer/test-car');await phone.getByRole('button',{name:'Открыть АвтоБота',exact:true}).tap();
 await phone.getByLabel('Сообщение АвтоБоту').fill('Какой расход?');const before=sendCount;
 await phone.getByRole('button',{name:'Отправить вопрос'}).tap();await phone.getByText('Ответ на первое нажатие',{exact:true}).waitFor();
 assert.equal(sendCount,before+1);assert.equal(await phone.getByLabel('Сообщение АвтоБоту').evaluate(e=>e===document.activeElement),false);
 assert.equal(await phone.locator('.ta-header').getByRole('button',{name:'Новый чат',exact:true}).count(),0);
 assert.equal(await phone.getByRole('button',{name:'Закрыть АвтоБота',exact:true}).isVisible(),true);
 await phone.getByRole('button',{name:'Настройки АвтоБота',exact:true}).tap();
 await phone.getByRole('button',{name:'Новый чат',exact:true}).tap();
 assert.equal(await phone.getByText('Ответ на первое нажатие',{exact:true}).count(),0);
 assert.equal(await phone.getByLabel('Сообщение АвтоБоту').inputValue(),'');
 assert.equal(await phone.locator('.ab-car-questions button').count(),4);
 assert.equal(await phone.locator('.ab-settings').count(),0);
 // Reuse the real calculator controls inside the native mobile chat dialog.
 formMode=true;
 await phone.getByLabel('Сообщение АвтоБоту').fill('Дай форму расчёта');await phone.getByRole('button',{name:'Отправить вопрос'}).tap();
 const form=phone.getByRole('region',{name:'Расчёт автомобиля в чате'});await form.waitFor();
 assert.equal(await form.getByLabel('Марка автомобиля',{exact:true}).inputValue(),'Honda');
 assert.equal(await form.getByLabel('Валюта',{exact:true}).inputValue(),'RUB');
 await form.getByRole('button',{name:'Рассчитать под ключ',exact:true}).tap();await form.getByText('1 234 567 ₽',{exact:true}).waitFor();
 assert.equal(calculationBody.price,'1000');assert.equal(calculationBody.currency,'RUB');assert.equal(calculationBody.city,'Кемерово');assert.equal(calculationBody.draft.engineCc,'1496');
 await form.getByRole('button',{name:'Выбрать город. Сейчас: Кемерово',exact:true}).tap();
 const picker=phone.getByRole('dialog',{name:'Выбор города',exact:true});await picker.waitFor();
 assert.equal(await picker.evaluate(el=>Boolean(el.closest('dialog.ab-panel'))),true);
 await picker.getByLabel('Поиск города').fill('Омск');await picker.getByRole('button',{name:'Выбрать город',exact:true}).tap();
 await form.getByRole('button',{name:'Выбрать город. Сейчас: Омск',exact:true}).waitFor();
 await phone.waitForFunction(()=>{try{return JSON.parse(sessionStorage.getItem('avtocena.autobot.tab.v1')||'{}').messages?.some(m=>m.calculationForm?.city==='Омск');}catch{return false;}});
 await phone.reload();const restoredForm=phone.getByRole('region',{name:'Расчёт автомобиля в чате'});await restoredForm.waitFor();
 assert.equal(await restoredForm.getByLabel('Валюта',{exact:true}).inputValue(),'RUB');await restoredForm.getByRole('button',{name:'Выбрать город. Сейчас: Омск',exact:true}).waitFor();

 // A mobile launcher moves only after holding and stays below the header.
 await phone.getByRole('button',{name:'Закрыть АвтоБота',exact:true}).click();
 const fab=phone.getByRole('button',{name:'Открыть АвтоБота',exact:true});const start=await fab.boundingBox();
 await phone.mouse.move(start.x+28,start.y+28);await phone.mouse.down();await phone.waitForTimeout(400);await phone.mouse.move(45,110,{steps:8});await phone.mouse.up();
 assert.equal(await phone.locator('dialog.ab-panel').count(),0);const moved=await fab.boundingBox();assert.ok(moved.y<150&&moved.x<40);
 await phone.reload();const retained=await fab.boundingBox();assert.ok(Math.abs(retained.y-moved.y)<2);await fab.tap();await phone.locator('dialog.ab-panel').waitFor();
 // Opening an electrified offer researches missing values once per tab/page.
 await phone.getByRole('button',{name:'Закрыть АвтоБота',exact:true}).click();
 await phone.goto('https://autobot.test/cars/offer/test-hybrid');
 await phone.evaluate(()=>{const main=document.createElement('main');main.dataset.autobotMissing=JSON.stringify(['сертифицированная 30-минутная мощность электромоторов']);document.body.append(main);});
 formMode=false;const beforeAuto=sendCount;const autoRequest=phone.waitForRequest(r=>r.url().endsWith('/api/autobot')&&r.method()==='POST');await phone.getByRole('button',{name:'Открыть АвтоБота',exact:true}).tap();await autoRequest;await phone.locator('.ab-thinking').waitFor({state:'hidden'});assert.equal(sendCount,beforeAuto+1);
 const widths=await phone.locator('.ab-car-questions button').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,parent:el.parentElement.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));assert.ok(widths.length);assert.ok(widths.every(x=>Math.abs(x.width-x.parent)<1&&x.height<60));
 await phone.getByRole('button',{name:'Закрыть АвтоБота',exact:true}).click();await phone.getByRole('button',{name:'Открыть АвтоБота',exact:true}).tap();await phone.waitForTimeout(300);assert.equal(sendCount,beforeAuto+1);
 await mobile.close();
 console.log('PASS: reload retains messages and draft, request retains history, new conversation clears, new tab starts empty');
}finally{await browser.close();}
