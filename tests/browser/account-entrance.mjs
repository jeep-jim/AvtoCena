import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/account-entrance'; fs.mkdirSync(out, {recursive: true});
await build({external:['/fonts/*'],entryPoints: ['tests/browser/account-entrance-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
  b.onResolve({filter: /^next\/(link|navigation)$/}, a => ({path: a.path, namespace: 'mock'}));
  b.onLoad({filter: /.*/, namespace: 'mock'}, a => ({contents: a.path === 'next/navigation' ? 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{},refresh:()=>{}});' : `import React from 'react';export default function Link(p){return React.createElement('a',p)}`, loader: 'jsx', resolveDir: process.cwd()}));
}}]});
const css = await postcss([tailwindcss({content: ['apps/web/components/**/*.tsx'], theme: {extend: {}}, plugins: []})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
const picture = await sharp({create: {width: 240, height: 280, channels: 4, background: '#4b654a'}}).webp().toBuffer();
const server = http.createServer((req, res) => {
  if (/^\/fonts\/inter-(latin|cyrillic)-wght-normal\.woff2$/.test(req.url)) {res.setHeader('Content-Type','font/woff2');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (/^\/avatars\/customers\/character-\d+\.svg$/.test(req.url)) {res.setHeader('Content-Type','image/svg+xml');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (req.url.startsWith('/api/site-media/')) {res.setHeader('Content-Type', 'image/webp'); return res.end(picture);}
  if (req.url === '/fixture.js') {res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(`${out}/fixture.js`));}
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`, 'utf8')}:root{--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-surface-3:#e3e7ee;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6;--ac-accent:#c91f2d}[data-theme=dark]{--ac-surface:#11141c;--ac-surface-2:#181b24;--ac-surface-3:#20232d;--ac-text:#edf3ff;--ac-muted:#9babc3;--ac-border:#ffffff22;--ac-accent:#ff303d}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:1120px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--no-sandbox']});
try {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({viewport: {width, height: 1000}}); let sent = 0;
    await page.route('**/api/account/auth', route => {sent++; return route.fulfill({status: 400, json: {error: 'Проверка формы'}});});
    await page.goto(origin + '/login'); await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    assert.equal(await page.getByText(/Вход для команды|Покупателю достаточно/).count(), 0);
    const resetRequests=[];
    await page.route('**/api/account/telegram',route=>{const body=route.request().postDataJSON();resetRequests.push(body);return route.fulfill({json:body.action==='recover'?{token:'a'.repeat(48),url:'https://t.me/avtocena_bot?start=account_'+ 'a'.repeat(48)}:{ok:true}});});
    await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();
    const recovery=page.getByRole('dialog',{name:'Восстановление пароля'});
    await recovery.waitFor();assert.equal(await recovery.getByRole('radio').count(),3);
    await recovery.getByLabel('Телефон',{exact:true}).fill('+79991234567');
    for(const channel of ['Почта','MAX']){await recovery.getByRole('radio',{name:new RegExp(channel)}).check();assert.equal(await recovery.getByRole('button',{name:'Продолжить',exact:true}).isDisabled(),true);}
    assert.equal(resetRequests.length,0);
    await recovery.getByRole('radio',{name:/Telegram/}).check();
    await page.screenshot({path:`${out}/recovery-${width}-${theme}.png`,fullPage:true});
    await recovery.getByRole('button',{name:'Продолжить',exact:true}).click();
    await recovery.getByRole('link',{name:'Открыть подтверждение ↗'}).waitFor();
    await recovery.getByLabel('Новый пароль',{exact:true}).fill('new-secure-password');
    await recovery.getByLabel('Повторите новый пароль',{exact:true}).fill('not-the-same-password');
    await recovery.getByRole('button',{name:'Сохранить новый пароль'}).click();
    await recovery.getByRole('alert').filter({hasText:'Пароли не совпадают'}).waitFor();assert.equal(resetRequests.length,1);
    await recovery.getByLabel('Повторите новый пароль',{exact:true}).fill('new-secure-password');
    await recovery.getByRole('button',{name:'Сохранить новый пароль'}).click();await recovery.waitFor({state:'detached'});
    assert.equal(resetRequests[1].action,'reset');assert.equal(resetRequests[1].token,'a'.repeat(48));
    await page.getByRole('status').filter({hasText:'Пароль изменён'}).waitFor();
    await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();await page.keyboard.press('Escape');await recovery.waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'Забыли пароль?',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button', {name: 'Регистрация', exact: true}).click();
    assert.equal(await page.locator('input[name="password-confirmation"]').count(), 0);
    await page.locator('input[name="phone"]').fill('+79991234567'); await page.locator('input[name="password"]').fill('a-secure-password');
    await page.getByRole('button', {name: 'Показать пароль: Пароль', exact: true}).click(); assert.equal(await page.locator('input[name="password"]').getAttribute('type'), 'text');
    await page.getByRole('button', {name: 'Скрыть пароль: Пароль', exact: true}).click();
    await page.locator('input[name="password-confirmation"]').fill('does-not-match'); await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', {name: 'Создать кабинет', exact: true}).click(); await page.getByRole('alert').filter({hasText: 'Пароли не совпадают'}).waitFor(); assert.equal(sent, 0);
    await page.locator('input[name="password-confirmation"]').fill('a-secure-password'); await page.getByRole('button', {name: 'Создать кабинет', exact: true}).click(); await page.getByRole('alert').filter({hasText: 'Проверка формы'}).waitFor(); assert.equal(sent, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({path: `${out}/register-${width}-${theme}.png`, fullPage: true});
    for (const [name, index] of [['АвтоДилер', 2], ['Автоблогер', 3], ['АвтоПоставщик', 4]]) {
      await page.getByRole('button', {name: new RegExp(name)}).click();
      assert.equal(await page.locator('.account-welcome-background').getAttribute('src'), '/api/site-media/' + String(index).repeat(64));
      if (index > 2) await page.getByRole('button',{name:'Подать заявку',exact:true}).waitFor();
      else {await page.getByLabel('Логин', {exact: true}).fill('example'); await page.getByRole('button', {name: 'Показать пароль: Пароль', exact: true}).click(); assert.equal(await page.locator('input[name="accessKey"]').getAttribute('type'), 'text');}
    }
    await page.getByRole('button', {name: 'Пользователь', exact: true}).click(); assert.equal(await page.locator('.account-welcome-background').getAttribute('src'), '/api/site-media/' + '1'.repeat(64));
    await page.goto(origin + '/login?role=team'); await page.getByText('Вход в кабинет', {exact: true}).waitFor(); assert.equal(await page.getByText('Вход для команды', {exact: true}).count(), 0);
    let saved; await page.route('**/api/crm/site-media', route => route.fulfill({json: {url: '/api/site-media/' + 'a'.repeat(64)}}));
    await page.route('**/api/crm/public-features', route => {saved = route.request().postDataJSON(); return route.fulfill({json: {...saved, version: 1}});});
    await page.goto(origin + '/crm/site'); await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); assert.equal(await page.locator('input[type="file"]').count(), 8);
    await page.getByLabel('Загрузить фон: Пользователь', {exact: true}).setInputFiles({name: 'banner.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Фон: Пользователь', {exact: true}).waitFor();
    await page.getByLabel('Загрузить иконку: АвтоПоставщик', {exact: true}).setInputFiles({name: 'icon.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Иконка: АвтоПоставщик', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Сохранить настройки', exact: true}).click(); await page.getByRole('status').filter({hasText: 'Настройки сайта сохранены'}).waitFor();
    assert.equal(saved.accountAppearance.customer.banner, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.accountAppearance.supplier.icon, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.affiliatesEnabled, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({path: `${out}/settings-${width}-${theme}.png`, fullPage: true}); await page.close();
  }
  for (const width of [320,390,1440]) for (const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    await page.goto(origin+'/login?scenes');await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    assert.equal(await page.locator('.account-scenes').count(),1);
    for(const role of ['customer','dealer','blogger','supplier']){
      if(role!=='customer') await page.getByRole('button',{name:new RegExp({dealer:'АвтоДилер',blogger:'Автоблогер',supplier:'АвтоПоставщик'}[role])}).click();
      await page.getByRole('button',{name:'Следующая сцена',exact:true}).click();
      assert.equal(await page.locator('.account-scene-controls button[aria-pressed=true]').innerText(),'2');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      await page.screenshot({path:`${out}/scenes-${role}-${width}-${theme}.png`,fullPage:true});
      const count=await page.locator('.step-node').count();
      assert.equal(count,role==='customer'?6:role==='dealer'?5:4);
      for(let n=0;n<count;n++){
        await page.locator('.step-node').nth(n).click();
        assert.equal(await page.locator('.step-node[aria-pressed=true]').innerText(),String(n+1));
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
        const clipped=await page.locator('.account-scenes .scene').evaluate(el=>{
          const outer=el.getBoundingClientRect();const child=el.firstElementChild.getBoundingClientRect();
          return child.height>outer.height+2 || child.width>outer.width+2;
        });
        if(clipped)await page.screenshot({path:`${out}/clipped-${role}-${n+1}-${width}-${theme}.png`,fullPage:true});
        assert.equal(clipped,false,`${role} scene ${n+1} must fit at ${width}/${theme}`);
        if((width===390||width===1440)&&theme==='dark')await page.screenshot({path:`${out}/original-${role}-${n+1}-${width}.png`,fullPage:true});
      }
      if(role==='customer'){
        await page.getByRole('button',{name:'4 звезды',exact:true}).click();assert.equal(await page.locator('.review-star.is-filled').count(),4);
        await page.getByRole('button',{name:'Пример публикации',exact:true}).click();await page.getByRole('status').filter({hasText:'Это пример'}).waitFor();
      }
    }
    let beta;await page.route('**/api/account/beta',route=>{beta=route.request().postDataJSON();return route.fulfill({json:{ok:true}});});
    await page.getByLabel('Имя или компания').fill('Тестовая компания');await page.getByLabel('Телефон, почта или Telegram').fill('@test');await page.getByLabel('О компании и направлениях поставок').fill('Проверяем заявку без реальной отправки');await page.locator('input[name=consent]').check();await page.getByRole('button',{name:'Подать заявку',exact:true}).click();await page.getByRole('status').filter({hasText:'Заявка принята'}).waitFor();assert.equal(beta.role,'supplier');assert.equal(beta.consent,true);await page.close();
  }
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});let saved;
    await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
    await page.route('**/api/account/auth',route=>route.fulfill({json:{account:{id:'test',name:'Тестовый покупатель',phone:'+79990000000',avatarId:'character-1',avatarUrl:'/avatars/customers/character-1.svg'}}}));
    await page.route('**/api/account/portal',route=>route.fulfill({json:{clients:[]}}));
    await page.route('**/api/account/notifications',route=>route.fulfill({json:{items:[{id:'n1',title:'Можно оставить отзыв',text:'Договор подтверждён',at:'2026-10-05T00:00:00Z',href:'/account?tab=reviews'}]}}));
    await page.route('**/api/account/profile',route=>{saved=route.request().postDataJSON();return route.fulfill({json:{account:{id:'test',phone:'+79990000000',name:saved.name,avatarId:saved.avatarId,avatarUrl:'/avatars/customers/'+saved.avatarId+'.svg',telegramConnected:true}}});});
    await page.goto(origin+'/account?tab=profile');await page.getByRole('heading',{name:'Ваш профиль',exact:true}).waitFor();await page.locator('.customer-header-tools').waitFor();if(width<761)assert.equal(await page.locator('.ac-public-header a[href="/"]>div').isVisible(),false,'compact customer header prevents wordmark overlap');assert.equal(await page.locator('.account-avatar-grid button').count(),20);
    await page.getByLabel('Как к вам обращаться').fill('Антон');await page.getByRole('button',{name:'Персонаж 12',exact:true}).click();await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();await page.getByRole('status').filter({hasText:'Профиль сохранён'}).waitFor();assert.equal(saved.avatarId,'character-12');await page.getByRole('heading',{name:'Здравствуйте, Антон'}).waitFor();
    await page.getByRole('button',{name:'Уведомления: 1',exact:true}).click();await page.getByText('Договор подтверждён',{exact:true}).waitFor();await page.getByRole('button',{name:'Прочитать все',exact:true}).click();await page.getByRole('button',{name:'Уведомления',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    await page.screenshot({path:`${out}/profile-notices-${width}.png`,fullPage:true});await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/login?scenes');
    await page.getByRole('button',{name:/Сцена 2:/}).click();await page.mouse.move(0,0);
    await page.locator('.contract-viewer.is-active').waitFor();
    await page.locator('.contract-signature.is-signing').waitFor();
    await page.locator('.contract-status.is-visible').waitFor();
    assert.equal(await page.locator('.contract-viewer-line.is-visible').count(),8);
    await page.getByRole('button',{name:/Сцена 3:/}).click();await page.mouse.move(0,0);
    const before=await page.locator('.track-truck').evaluate(el=>el.getBoundingClientRect().left);
    await page.waitForTimeout(1000);
    const after=await page.locator('.track-truck').evaluate(el=>el.getBoundingClientRect().left);assert.ok(after>before+2,'car moves along original route');
    await page.getByRole('button',{name:'Остановить смену сцен',exact:true}).click();
    await page.getByRole('button',{name:/Сцена 1:/}).click();
    assert.equal(await page.locator('.chat-msg').first().evaluate(el=>getComputedStyle(el).opacity),'1');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(JSON.stringify({passed: true, widths: [390, 1440], themes: ['light', 'dark'], passwordConfirmation: true, fourRoleBackgrounds: true, eightUploads: true, settingsSaved: true, legacyStaffEntry: true}));
} finally {await browser.close(); await new Promise(r => server.close(r));}
