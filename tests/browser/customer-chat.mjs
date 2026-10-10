import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';
import {build} from 'esbuild';import postcss from 'postcss';import tailwindcss from 'tailwindcss';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out='artifacts/customer-chat';fs.mkdirSync(out,{recursive:true});
await build({external:['/*'],entryPoints:['tests/browser/customer-chat-fixture.tsx'],bundle:true,format:'esm',platform:'browser',jsx:'automatic',outfile:`${out}/fixture.js`,define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.tsx']})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=http.createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(`${out}/fixture.js`));}res.setHeader('content-type','text/html');res.end(`<!doctype html><html data-theme="light"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`,'utf8')}:root{--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-text:#17243d;--ac-muted:#657080;--ac-border:#ccd0d6}body{margin:0}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
 const composer=page.getByRole('textbox',{name:'Сообщение менеджеру'});await composer.waitFor();
 const dimensions=await page.locator('.customer-account-chat').evaluate(root=>{const list=root.querySelector('.ac-chat-messages'),form=root.querySelector('form');return {scroll:list.scrollHeight-list.scrollTop-list.clientHeight,bottom:form.getBoundingClientRect().bottom,height:innerHeight,overflow:root.scrollHeight-root.clientHeight};});
 assert.ok(dimensions.scroll<5,JSON.stringify(dimensions));assert.ok(dimensions.bottom<=dimensions.height+1,JSON.stringify(dimensions));assert.ok(dimensions.overflow<5,JSON.stringify(dimensions));
 await composer.fill('Черновик проверки');
 if(width<768){await page.getByRole('button',{name:'Свернуть чат',exact:true}).click();assert.equal(await page.getByRole('dialog',{name:'Чат с менеджером'}).count(),0);await page.getByRole('button',{name:/Открыть чат/}).click();assert.equal(await composer.inputValue(),'Черновик проверки');}
 await page.getByRole('button',{name:'Отправить',exact:true}).click();await page.getByText('Черновик проверки',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Меню чата'}).click();const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Прикрепить документ',exact:true}).click();await (await chooser).setFiles({name:'test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});await page.getByText('Добавлен документ: test.pdf',{exact:true}).waitFor();
 await page.screenshot({path:`${out}/chat-${width}.png`});
 if(width<768)await page.getByRole('button',{name:'Свернуть чат',exact:true}).click();
 await page.getByRole('button',{name:'Цвет',exact:true}).click();const name=page.getByRole('textbox',{name:'Свой оттенок или заводское название'});assert.equal(await name.inputValue(),'Чёрный');await page.getByRole('textbox',{name:'HEX',exact:true}).fill('#ffffff');assert.equal(await name.inputValue(),'Белый');await page.getByRole('button',{name:'Готово',exact:true}).click();await page.getByRole('button',{name:'Цвет',exact:true}).click();assert.equal(await name.inputValue(),'Белый');assert.equal(await page.getByRole('textbox',{name:'HEX',exact:true}).inputValue(),'#ffffff');
 assert.deepEqual(errors,[]);await page.screenshot({path:`${out}/color-${width}.png`});await page.close();console.log(`customer chat/color ${width}: passed`);
}}finally{await browser.close();server.close();}
