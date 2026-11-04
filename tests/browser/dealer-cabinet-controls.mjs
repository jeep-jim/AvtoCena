import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/dealer-cabinet-controls';fs.mkdirSync(out,{recursive:true});
const fixtureUser={id:'owner',role:'dealer',companyId:'dealer_test',displayName:'Тестовый сотрудник',telegramUsername:'owner',status:'active',dealerApproved:true,dealerTeamRole:'owner'};
const fixtureStaff=[fixtureUser,{...fixtureUser,id:'staff',displayName:'Сотрудник',telegramUsername:'staff',dealerTeamRole:'manager'}];
const fixtureLeads=[{id:'visible',requestedDealerId:'dealer_test',name:'Клиент для проверки',phone:'+70000000000',car:'Geely Vision X3',createdAt:'2026-11-04T01:00:00Z',assignedManagerId:'owner',platformTerms:{agreementDigest:'fixture'},status:'new'},{id:'hidden',requestedDealerId:'dealer_test',name:'SECRET_CONTACT',phone:'SECRET_PHONE',car:'SECRET_CAR',createdAt:'2026-11-04T02:00:00Z',status:'new'},{id:'foreign',requestedDealerId:'dealer_other',name:'FOREIGN_CONTACT',phone:'FOREIGN_PHONE',createdAt:'2026-11-04T02:00:00Z'}];
const fixtureClients=[{id:'client',fio:'Клиент для проверки',phone:'+70000000000',city:'Новокузнецк',assignedManagerId:'owner',createdAt:'2026-11-04T01:00:00Z',documents:[]}];
const mocks={
 '@/lib/dealers/cabinet-user':`export const cabinetUser=async()=>({...${JSON.stringify(fixtureUser)},dealerTeamRole:new URLSearchParams(location.search).get('owner')==='1'?'owner':'manager'});`,
 '@/lib/auth':`export const getCurrentUser=async()=>(${JSON.stringify(fixtureUser)});`,
 '@/lib/crm-users':`export const readCrmUsers=async()=>(${JSON.stringify(fixtureStaff)});`,
 '@/lib/data':`export const readChunkedDataJson=async path=>path==='leads/leads.json'?${JSON.stringify(fixtureLeads)}:${JSON.stringify(fixtureClients)};`,
 '@/lib/dealers/client-workflow':'export const readyDealerClients=async(user,clients)=>clients;',
 '@/lib/dealers/team':"export const isDealerTeamOwner=user=>user.dealerTeamRole==='owner';",
 '@/lib/document-workspace':"export const documentCompany=user=>user.companyId;export const canUseDocuments=async()=>true;export const workspaceClientsPath=()=>'clients.json';export const canAccessDocumentClient=()=>true;",
 '@/lib/account/portal':'export const customerLeads=async()=>[];'
};
await build({entryPoints:['tests/browser/dealer-cabinet-controls-fixture.tsx'],bundle:true,external:['/map-preview.svg'],format:'esm',platform:'browser',jsx:'automatic',outfile:out+'/fixture.js',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next-and-storage',setup(b){b.onResolve({filter:/.*/},a=>{const key=a.path.endsWith('/lib/dealers/cabinet-user')?'@/lib/dealers/cabinet-user':a.path;return mocks[key]?{path:key,namespace:'storage'}:undefined;});b.onLoad({filter:/.*/,namespace:'storage'},a=>({contents:mocks[a.path],loader:'ts'}));b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/link'?"import React from 'react';export default function Link({prefetch,...p}){return React.createElement('a',p)}":"export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});export const redirect=path=>{throw Error('Unexpected redirect '+path)};",loader:'jsx',resolveDir:process.cwd()}));}}]});
const sourceCss=['select-controls.css','globals.css','catalog-ui.css','public-polish.css','flat-ui.css','(crm)/crm-responsive.css'].map(p=>fs.readFileSync('apps/web/app/'+p,'utf8')).join('\n');
const css=(await postcss([tailwindcss({content:['tests/browser/dealer-cabinet-controls-fixture.tsx','apps/web/components/{crm,dealers}/**/*.tsx','apps/web/app/(public)/dealer-cabinet/**/*.tsx']})]).process(sourceCss,{from:undefined})).css;
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'||req.url==='/fixture.css'){res.setHeader('Content-Type',req.url.endsWith('css')?'text/css':'text/javascript');res.end(fs.readFileSync(out+req.url));return;}if(req.url.startsWith('/avatars/')||req.url.startsWith('/logo/')){const file='apps/web/public'+req.url;if(fs.existsSync(file)){res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(file));return;}res.writeHead(404).end();return;}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html data-theme="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN,args:['--no-sandbox']});
try{for(const width of [390,1440])for(const theme of ['dark','light']){const page=await browser.newPage({viewport:{width,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});});
await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;let body={ok:true};if(path==='/api/dealers/team')body={ok:true,key:'fixture-only-not-real'};if(path==='/api/dealers/presence')body={team:fixtureStaff.map(u=>({...u,online:false}))};if(path==='/api/dealers/contracts')body={records:[],templates:[]};if(path==='/api/crm/customer-access')body={messages:[],linked:false};return r.fulfill({contentType:'application/json',body:JSON.stringify(body)});});
async function visit(path){await page.goto(origin+path);await page.locator('.crm-content').waitFor();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);}
async function shot(name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow: '+name);await page.screenshot({path:`${out}/${width}-${theme}-${name}.png`,fullPage:true});}
await visit('/dealer-cabinet/profile?owner=1');
const nav=page.getByRole('navigation',{name:'Кабинет дилера'});assert.deepEqual(await nav.locator('a').allTextContents(),['Обзор','Заявки2','Клиенты','Сотрудники','Кабинет']);await nav.getByRole('button',{name:'Выйти'}).waitFor();if(width===390){const positions=await nav.locator('a').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert.equal(new Set(positions).size,1,'mobile tabs stay on one row');assert.ok(await nav.evaluate(n=>n.scrollWidth>n.clientWidth),'mobile tabs scroll horizontally');}
assert.equal(await nav.locator('.crm-navigation-badge').evaluate(el=>getComputedStyle(el).position),'absolute');
await page.getByRole('button',{name:'Копировать ссылку на дилера'}).click();assert.equal(await page.evaluate(()=>window.copied),'https://avtocena.com/dealers/test');
await page.getByLabel('Имя',{exact:true}).fill('Новое имя');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByText('Профиль сохранён').waitFor();
assert.equal(await page.getByRole('button',{name:'Подборка для клиента'}).count(),0,'selection starts only inside account menu');
await page.getByRole('button',{name:'Кабинет сотрудника'}).click();assert.equal(await page.getByRole('link',{name:'Мой профиль',exact:true}).getAttribute('href'),'/dealer-cabinet/profile');await shot('profile-menu');
await page.getByRole('button',{name:'Подборка для клиента'}).click();await page.getByRole('dialog',{name:'Подборка для клиента'}).waitFor();await page.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);await page.keyboard.press('Escape');assert.equal(await page.locator('#dealer-account-menu').count(),0);
await visit('/dealer-cabinet/team?owner=1');await page.getByLabel('Имя сотрудника').fill('Новый сотрудник');await page.getByLabel('Логин сотрудника').fill('new_staff');await page.getByRole('button',{name:'Создать сотрудника'}).click();await page.getByText('Ключ: fixture-only-not-real').waitFor();await shot('team');
await visit('/dealer-cabinet/team');assert.equal(await page.getByRole('button',{name:'Создать сотрудника'}).count(),0);
await visit('/dealer-cabinet/overview');await page.getByRole('heading',{name:'Команда в сети'}).waitFor();await shot('overview');
await visit('/dealer-cabinet/leads');await page.getByText('Клиент для проверки',{exact:true}).waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/SECRET_|FOREIGN_/);await shot('leads');await page.getByRole('button',{name:/Фильтры/}).click();await page.getByRole('dialog').waitFor();await shot('lead-filters');
await visit('/dealer-cabinet/leads?layout=board');await page.getByLabel('Заявки по этапам').waitFor();assert.doesNotMatch(await page.locator('body').innerText(),/SECRET_|FOREIGN_/);await shot('board');
await visit('/dealer-cabinet/documents');await page.getByText('Клиент для проверки',{exact:true}).waitFor();await shot('clients');await page.getByRole('button',{name:'Плитки клиентов'}).click();await shot('clients-grid');
assert.deepEqual(errors,[]);await page.close();console.log(`dealer controls ${width} ${theme}: PASS`);}}finally{await browser.close();server.close();}
