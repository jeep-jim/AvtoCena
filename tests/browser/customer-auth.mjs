import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import {customerAuthHarness} from '../helpers/customer-auth-harness.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
process.env.AUTH_SECRET='isolated-browser-auth-secret';
const auth=await customerAuthHarness();
const out='artifacts/customer-auth';fs.mkdirSync(out,{recursive:true});
await build({entryPoints:['tests/browser/account-entrance-fixture.tsx'],outfile:`${out}/fixture.js`,external:['/fonts/*'],bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'next',setup(b){b.onResolve({filter:/^next\/(link|navigation)$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='next/navigation'?'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{},refresh:()=>{}});':`import React from 'react';export default function Link(p){return React.createElement('a',p)}`,loader:'jsx',resolveDir:process.cwd()}));}}]});
const css=await postcss([tailwindcss({content:['apps/web/components/**/*.tsx'],theme:{extend:{}},plugins:[]})]).process('@tailwind base;@tailwind components;@tailwind utilities;',{from:undefined});
const server=http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://'+req.headers.host);
 if(url.pathname==='/api/account/auth'){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await auth.handle(new Request(url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
  res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(await response.text());
 }
 if(url.pathname==='/api/auth/me'||url.pathname==='/api/account/portal'||url.pathname==='/api/account/notifications'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({user:null,clients:[],items:[]}));}
 if(req.url==='/fixture.js'){res.setHeader('content-type','application/javascript');return res.end(fs.readFileSync(`${out}/fixture.js`));}
 if(/^\/(fonts|avatars\/customers|logo|dealers)\/[\w.-]+$/.test(url.pathname)&&fs.existsSync('apps/web/public'+url.pathname)){res.setHeader('content-type',url.pathname.endsWith('.svg')?'image/svg+xml':'font/woff2');return res.end(fs.readFileSync('apps/web/public'+url.pathname));}
 let account=null;
 if(url.pathname==='/account'){
  account=(await (await auth.handle(new Request(new URL('/api/account/auth',url),{headers:req.headers}))).json()).account;
  if(!account){res.writeHead(302,{location:'/login?scenes'});return res.end();}
 }
 res.setHeader('content-type','text/html');res.end(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`,'utf8')}:root{--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6}[data-theme=dark]{--ac-surface:#11141c;--ac-surface-2:#181b24;--ac-text:#edf3ff;--ac-muted:#9babc3;--ac-border:#ffffff22}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:1120px;margin:auto}</style></head><body><div id="root"></div><script>window.__CUSTOMER_ACCOUNT__=${JSON.stringify(account)}</script><script type="module" src="/fixture.js"></script></body></html>`);
 }catch(error){res.writeHead(500);res.end('Isolated test server error');console.error(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||undefined,headless:true,args:['--no-sandbox']});
try{
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:1000},isMobile:width===390,hasTouch:width===390});
  await context.addCookies([{name:'avtocena_session',value:'isolated-staff-session',url:origin}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/login?scenes');await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  const phone=page.locator('[name=customer-phone]'),password=page.locator('[name=customer-password]');
  // Simulate a password manager changing the DOM without input/change events.
  await phone.evaluate(input=>input.value='staff-login');
  await page.getByRole('button',{name:'Создать кабинет',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'цифрами'}).waitFor();
  await phone.fill('+79991');await password.focus();await page.getByRole('alert').filter({hasText:'не хватает'}).waitFor();
  const number='+79990'+String(width).padStart(4,'0')+(theme==='light'?'01':'02');
  await phone.fill(number);
  await password.evaluate(input=>input.value='isolated-test-password');
  await page.getByRole('button',{name:'Показать пароль: Пароль',exact:true}).click();
  assert.equal(await password.inputValue(),'isolated-test-password');assert.equal(await password.getAttribute('type'),'text');
  await page.getByRole('button',{name:'Скрыть пароль: Пароль',exact:true}).click();assert.equal(await password.inputValue(),'isolated-test-password');
  assert.equal(await password.getAttribute('autocomplete'),'section-customer new-password');
  const repeat=page.locator('[name=customer-password-confirmation]');await repeat.fill('wrong-password');
  await page.getByRole('alert').filter({hasText:'Пароли не совпадают'}).waitFor();
  await page.screenshot({path:`${out}/errors-${width}-${theme}.png`,fullPage:true});
  await repeat.fill('isolated-test-password');assert.equal(await page.getByRole('alert').filter({hasText:'Пароли не совпадают'}).count(),0);
  await page.getByRole('checkbox').check();await page.screenshot({path:`${out}/register-${width}-${theme}.png`,fullPage:true});
  await page.getByRole('button',{name:'Создать кабинет',exact:true}).click();
  await page.waitForURL(origin+'/account');await page.getByRole('heading',{name:'Здравствуйте, Покупатель'}).waitFor();
  await page.getByRole('heading',{name:'Всё начинается с заявки'}).waitFor();
  assert.equal((await context.cookies()).find(cookie=>cookie.name==='avtocena_session').value,'isolated-staff-session');
  await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.waitForURL(/\/login/);
  // Silent autofill must also submit the native value without requiring reveal.
  await page.locator('[name=customer-phone]').evaluate((input,value)=>input.value=value,number);
  await page.locator('[name=customer-password]').evaluate(input=>input.value='isolated-test-password');
  await page.getByRole('button',{name:'Войти в кабинет',exact:true}).click();await page.waitForURL(origin+'/account');
  await page.getByRole('heading',{name:'Здравствуйте, Покупатель'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Здравствуйте, Покупатель'}).waitFor();
  assert.deepEqual(errors,[]);await context.close();
 }
 {
  const page=await browser.newPage();await page.goto(origin+'/login?scenes');
  await page.route('**/api/account/auth',route=>route.request().method()==='GET'?route.fulfill({json:{account:null}}):route.continue());
  await page.locator('[name=customer-phone]').fill('+79990039001');await page.locator('[name=customer-password]').fill('isolated-test-password');
  await page.getByRole('button',{name:'Войти в кабинет',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Не удалось сохранить вход'}).waitFor();assert.match(page.url(),/\/login/);await page.close();
 }
 console.log('PASS: mobile/desktop, both themes, inline errors, silent autofill, password reveal, registration → cabinet → logout → login → reload; staff cookie unchanged');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));delete globalThis.__customerAuthTest;}
