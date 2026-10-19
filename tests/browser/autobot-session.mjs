import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||createRequire(import.meta.url).resolve('playwright'));
const out='/tmp/avtocena-autobot-session';fs.mkdirSync(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {Autobot} from './apps/web/components/autobot/Autobot';createRoot(document.getElementById('root')).render(<Autobot/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,external:['/autobot/*'],platform:'browser',jsx:'automatic',outfile:out+'/app.js',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'navigation',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const usePathname=()=>location.pathname;`}));}}]});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 const context=await browser.newContext();let sent;let sendCount=0;
 await context.route('https://autobot.test/**',route=>{const u=new URL(route.request().url());
 if(u.pathname==='/api/autobot'){if(route.request().method()==='POST'){sendCount++;sent=route.request().postDataJSON();return route.fulfill({json:{text:'Город — Омск.',cards:[],sources:[]}});}return route.fulfill({json:{connected:true}});}
 if(u.pathname.startsWith('/api/'))return route.fulfill({status:403,json:{}});
 if(u.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(out+'/app.js','utf8')});
 if(u.pathname==='/app.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync(out+'/app.css','utf8')});
 return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'});});
 const page=await context.newPage();await page.goto('https://autobot.test/cars');await page.getByRole('button',{name:'Открыть АвтоБота',exact:true}).click();
 await page.getByLabel('Сообщение АвтоБоту').fill('Мой город Омск');await page.getByRole('button',{name:'Отправить вопрос'}).click();await page.getByText('Город — Омск.',{exact:true}).waitFor();
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
 assert.equal(await fresh.locator('.ab-car-questions button').count(),3);
 await fresh.reload();await fresh.locator('.ab-car-questions').waitFor();assert.equal(await fresh.locator('.ab-car-questions button').count(),3);
 // A touch click must send exactly once and release the keyboard focus.
 const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.route('https://autobot.test/**',async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/api/autobot'){if(route.request().method()==='POST'){sendCount++;return route.fulfill({json:{text:'Ответ на первое нажатие',cards:[],sources:[]}});}return route.fulfill({json:{connected:true}});}
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
 await mobile.close();
 console.log('PASS: reload retains messages and draft, request retains history, new conversation clears, new tab starts empty');
}finally{await browser.close();}
