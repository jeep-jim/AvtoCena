import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/dealer-cabinet-controls';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/dealer-cabinet-controls-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:out+'/fixture.js',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/link'?"import React from 'react';export default function Link(p){return React.createElement('a',p)}":"export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});",loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=(await postcss([tailwindcss({content:['tests/browser/dealer-cabinet-controls-fixture.tsx','apps/web/components/dealers/*.tsx']})]).process('@tailwind utilities;'+fs.readFileSync('apps/web/app/(public)/dealer-cabinet/cabinet.css','utf8'),{from:undefined})).css;
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(out+'/fixture.js'));return;}res.setHeader('Content-Type','text/html');res.end(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--ac-page-bg:#1b222c;--ac-surface:#273241;--ac-surface-2:#303c4d;--ac-text:#fff;--ac-border:#455060}*{box-sizing:border-box}body{margin:0;background:var(--ac-page-bg);color:var(--ac-text);font:16px Arial}a{color:inherit;text-decoration:none}button,input{font:inherit;color:inherit}button{cursor:pointer;border:0}input{max-width:100%}${css}</style><div id="root"></div><script type="module" src="/fixture.js"></script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});});
await page.route('**/api/dealers/profile',r=>r.fulfill({contentType:'application/json',body:'{"ok":true}'}));
await page.route('**/api/dealers/team',r=>r.fulfill({contentType:'application/json',body:'{"ok":true,"key":"fixture-only-not-real"}'}));
await page.goto(origin+'/dealer-cabinet?owner=1');
const nav=page.getByRole('navigation',{name:'Кабинет дилера'});assert.deepEqual(await nav.locator('a').allTextContents(),['Обзор','Заявки2','Клиенты','Сотрудники','Кабинет']);await nav.getByRole('button',{name:'Выйти'}).waitFor();if(width===390){const positions=await nav.locator('a').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.equal(new Set(positions).size,1,'mobile tabs stay on one row');assert.ok(await nav.evaluate(n=>n.scrollWidth>n.clientWidth),'mobile tabs scroll horizontally');}
await page.getByRole('button',{name:'Копировать ссылку на дилера'}).click();assert.equal(await page.evaluate(()=>window.copied),'https://avtocena.com/dealers/test');
await page.getByLabel('Имя',{exact:true}).fill('Новое имя');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Профиль сохранён').waitFor();
await page.getByLabel('Имя сотрудника').fill('Новый сотрудник');await page.getByLabel('Логин сотрудника').fill('new_staff');await page.getByRole('button',{name:'Создать сотрудника'}).click();await page.getByText('Ключ: fixture-only-not-real').waitFor();
await page.getByRole('button',{name:'Подборка для клиента'}).click();await page.getByRole('dialog',{name:'Подборка для клиента'}).waitFor();await page.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');await page.screenshot({path:`${out}/${width}.png`,fullPage:true});
await page.goto(origin+'/dealer-cabinet');assert.equal(await page.getByRole('button',{name:'Создать сотрудника'}).count(),0);await page.getByText('Сотрудник',{exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();console.log(`dealer controls ${width}: PASS`);}}finally{await browser.close();server.close();}
