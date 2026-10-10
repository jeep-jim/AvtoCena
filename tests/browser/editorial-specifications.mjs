import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/editorial-specifications';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/editorial-specifications-fixture.tsx'],bundle:true,format:'iife',platform:'browser',jsx:'automatic',outfile:`${out}/app.js`,tsconfig:'apps/web/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next-fixture',setup(b){
 b.onResolve({filter:/^next\/(navigation|link)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path.endsWith('navigation')?'export const useRouter=()=>({refresh(){},push(){}});':`import React from 'react';export default function Link(props){return React.createElement('a',props);}`,resolveDir:process.cwd()}));
}}]});
const css=await postcss([tailwindcss({content:['apps/web/components/catalog/CatalogEditorialEditor.tsx','apps/web/components/ui/PublicSheet.tsx','tests/browser/editorial-specifications-fixture.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
fs.appendFileSync(`${out}/app.css`,css.css);
const server=http.createServer((req,res)=>{if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'application/javascript':'text/css');res.end(fs.readFileSync(out+req.url));return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
try{for(const width of [390,1440])for(const theme of ['light','dark']){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let payload,fail=false;
 await page.route('**/api/catalog/offer/fixture/editorial',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:fail?409:200,json:fail?{error:'Объявление уже изменено другим сотрудником.'}:{entry:{...payload,version:'saved'}}});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await page.getByRole('button',{name:'Редактировать объявление',exact:true}).click();
 await page.route('**/api/crm/catalog/photos',async route=>{assert.equal(route.request().postDataJSON().url,'https://example.com/car.jpg');await route.fulfill({json:{id:'a'.repeat(64),url:'/api/site-media/'+'a'.repeat(64)}});});
 const form=page.getByRole('form',{name:'Редактирование объявления',exact:true});
 await form.getByLabel('Кузов',{exact:true}).selectOption('suv');await form.getByLabel('Привод',{exact:true}).selectOption('awd');await form.getByLabel('Коробка передач',{exact:true}).selectOption('cvt');await form.getByLabel('Цвет',{exact:true}).fill('Синий');
 assert.equal(await form.getByRole('button',{name:'Изменить параметры',exact:true}).count(),0);
 await form.getByRole('button',{name:'Добавить по ссылке',exact:true}).click();await form.getByLabel('Ссылка на фотографию',{exact:true}).fill('https://example.com/car.jpg');await form.getByRole('button',{name:'Добавить фото',exact:true}).click();await form.getByRole('button',{name:'Сделать фото 1 обложкой',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:`${out}/${width}-${theme}.png`});
 await form.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await form.waitFor({state:'hidden'});
 assert.deepEqual(payload.specifications,{bodyType:'suv',drive:'awd',transmission:'cvt',color:'Синий'});assert.deepEqual(payload.photos,['/api/site-media/'+'a'.repeat(64)]);assert.equal(payload.year,undefined);assert.equal(payload.powerHp,undefined);
 await page.getByRole('button',{name:'Редактировать объявление',exact:true}).click();assert.equal(await form.getByLabel('Кузов',{exact:true}).inputValue(),'suv');
 await form.getByLabel('Кузов',{exact:true}).selectOption('');await form.getByLabel('Цвет',{exact:true}).fill('');fail=true;
 await form.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await form.getByRole('alert').waitFor();assert.equal(await form.isVisible(),true);assert.equal(payload.version,'saved');assert.equal(payload.specifications.bodyType,'');
 console.log(JSON.stringify({width,theme,saved:true,conflictRetainsForm:true}));await context.close();
}}finally{await browser.close();server.close();}
