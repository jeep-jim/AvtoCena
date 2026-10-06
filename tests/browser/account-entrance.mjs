import assert from 'node:assert/strict';
import {checkDealerPreview} from './dealer-preview-checks.mjs';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/account-entrance'; fs.mkdirSync(out, {recursive: true});
await build({external:['/fonts/*','/brands/*'],entryPoints: ['tests/browser/account-entrance-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
  b.onResolve({filter: /^next\/(link|navigation)$/}, a => ({path: a.path, namespace: 'mock'}));
  b.onLoad({filter: /.*/, namespace: 'mock'}, a => ({contents: a.path === 'next/navigation' ? 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{},refresh:()=>{}});' : `import React from 'react';export default function Link(p){return React.createElement('a',p)}`, loader: 'jsx', resolveDir: process.cwd()}));
}}]});
const css = await postcss([tailwindcss({content: ['apps/web/components/**/*.tsx'], theme: {extend: {}}, plugins: []})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
const picture = await sharp({create: {width: 240, height: 280, channels: 4, background: '#4b654a'}}).webp().toBuffer();
const server = http.createServer((req, res) => {
  if (/^\/fonts\/inter-(latin|cyrillic)-wght-normal\.woff2$/.test(req.url)) {res.setHeader('Content-Type','font/woff2');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (/^\/avatars\/customers\/(?:character|city-cars|offroad-cars)-\d+\.svg$/.test(req.url)) {res.setHeader('Content-Type','image/svg+xml');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (req.url==='/dealers/default-cover.svg'||req.url==='/logo/avtocena-mark-dark.svg'||req.url==='/logo/avtocena-mark-light.svg') {res.setHeader('Content-Type','image/svg+xml');return res.end(fs.readFileSync('apps/web/public'+req.url));}
  if (req.url.startsWith('/api/site-media/')&&req.url.endsWith('.mp4')) {res.setHeader('Content-Type','video/mp4');return res.end(fs.readFileSync('apps/web/public/account-media/loading-oct05.mp4'));}
  if (req.url.startsWith('/api/site-media/')) {res.setHeader('Content-Type', 'image/webp'); return res.end(picture);}
  if(req.url==='/key-logo.png'){res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync('apps/web/public/key-logo.png'));}
  if (req.url === '/fixture.js') {res.setHeader('Content-Type', 'application/javascript'); return res.end(fs.readFileSync(`${out}/fixture.js`));}
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}${fs.readFileSync(`${out}/fixture.css`, 'utf8')}:root{--ac-page-bg:#edf0f6;--ac-bg:var(--ac-page-bg);--ac-surface:#fff;--ac-surface-2:#edf0f5;--ac-surface-3:#e3e7ee;--ac-text:#171b24;--ac-muted:#657080;--ac-border:#ccd0d6;--ac-accent:#c91f2d}[data-theme=dark]{--ac-page-bg:#1a2029;--ac-surface:#11141c;--ac-surface-2:#181b24;--ac-surface-3:#20232d;--ac-text:#edf3ff;--ac-muted:#9babc3;--ac-border:#ffffff22;--ac-accent:#ff303d}.account-cabinet-page .ac-public-header{position:fixed!important;inset:0 0 auto 0!important;width:100%!important}body{margin:0;padding:16px;background:var(--ac-surface);color:var(--ac-text)}#root{max-width:1120px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r)); const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath: process.env.CHROME_BIN || undefined, headless: true, args: ['--no-sandbox']});
try {
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({viewport: {width, height: 1000}}); let sent = 0;
    await page.route('**/api/account/auth', route => {if(route.request().method()==='POST')sent++; return route.fulfill({status: 400, json: {error: 'Проверка формы'}});});
    await page.goto(origin + '/login'); await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    assert.equal(await page.getByText(/Вход для команды|Покупателю достаточно/).count(), 0);
    assert.equal(await page.locator('.account-selected-title h2').innerText(),'Пользователь');assert.equal(await page.locator('.account-selected-icon img').getAttribute('src'),'/api/site-media/'+'5'.repeat(64));
    const resetRequests=[];
    await page.route('**/api/account/telegram',route=>{const body=route.request().postDataJSON();resetRequests.push(body);return route.fulfill({json:body.action==='recover'?{token:'a'.repeat(48),url:'https://t.me/avtocena_bot?start=account_'+ 'a'.repeat(48)}:{ok:true}});});
    await page.getByRole('button',{name:'Забыли пароль?',exact:true}).click();
    const recovery=page.getByRole('dialog',{name:'Восстановление пароля'});
    await recovery.waitFor();assert.equal(await recovery.getByRole('radio').count(),3);
    await recovery.getByLabel('Телефон, указанный при регистрации',{exact:true}).fill('+79991234567');
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
    assert.equal(await page.locator('input[name="customer-password-confirmation"]').count(), 0);
    await page.locator('input[name="customer-phone"]').fill('+79991234567'); await page.locator('input[name="customer-password"]').fill('a-secure-password');
    await page.getByRole('button', {name: 'Показать пароль: Пароль', exact: true}).click(); assert.equal(await page.locator('input[name="customer-password"]').getAttribute('type'), 'text');
    await page.getByRole('button', {name: 'Скрыть пароль: Пароль', exact: true}).click();
    await page.locator('input[name="customer-password-confirmation"]').fill('does-not-match'); await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', {name: 'Создать кабинет', exact: true}).click(); await page.getByRole('alert').filter({hasText: 'Пароли не совпадают'}).waitFor(); assert.equal(sent, 0);
    await page.locator('input[name="customer-password-confirmation"]').fill('a-secure-password'); await page.getByRole('button', {name: 'Создать кабинет', exact: true}).click(); await page.getByRole('alert').filter({hasText: 'Проверка формы'}).waitFor(); assert.equal(sent, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({path: `${out}/register-${width}-${theme}.png`, fullPage: true});
    for (const [name, index] of [['Автодилер', 2], ['Автоблогер', 3], ['Автопоставщик', 4]]) {
      await page.getByRole('button', {name: new RegExp(name)}).click();
      if(index===2){assert.equal(await page.locator('.account-selected-icon img').getAttribute('src'),'/api/site-media/'+'6'.repeat(64));}if(index===2)assert.equal(await page.locator('.account-welcome-background').getAttribute('src'), '/api/site-media/' + String(index).repeat(64));
      if (index > 2) await page.getByText('Этот раздел ещё в разработке, скоро появится ;)',{exact:true}).waitFor();
      else {await page.getByLabel('Логин', {exact: true}).fill('example'); await page.getByRole('button', {name: 'Показать пароль: Пароль', exact: true}).click(); assert.equal(await page.locator('input[name="accessKey"]').getAttribute('type'), 'text');}
    }
    await page.getByRole('button', {name: 'Пользователь', exact: true}).click(); assert.equal(await page.locator('.account-welcome-background').getAttribute('src'), '/api/site-media/' + '1'.repeat(64));
    await page.goto(origin + '/login?role=team'); await page.locator('#account-login-form').getByRole('heading',{name:'Автодилер',exact:true}).waitFor(); assert.equal(await page.getByText('Вход для команды', {exact: true}).count(), 0);
    let saved; await page.route('**/api/crm/site-media', route => route.fulfill({json: route.request().headers()['content-type']?.includes('application/json')&&route.request().postDataJSON().action==='start'?{token:'fixture-token',chunkSize:2097152}:{url: '/api/site-media/' + 'a'.repeat(64)}}));
    await page.route('**/api/crm/public-features', route => {saved = route.request().postDataJSON(); return route.fulfill({json: {...saved, version: 1}});});
    await page.goto(origin + '/crm/site'); await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); assert.equal(await page.locator('input[type="file"]').count(), 17);
    await page.getByLabel('Загрузить фон: Пользователь', {exact: true}).setInputFiles({name: 'banner.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Фон: Пользователь', {exact: true}).waitFor();
    await page.getByLabel('Загрузить иконку: Автопоставщик', {exact: true}).setInputFiles({name: 'icon.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Иконка: Автопоставщик', {exact: true}).waitFor();
    await page.getByLabel('Цвет фона: Пользователь, светлая тема',{exact:true}).fill('#bddaf7');
    await page.getByLabel('Фон блока: Пользователь, тёмная тема',{exact:true}).setInputFiles({name:'back.webp',mimeType:'image/webp',buffer:picture});await page.getByAltText('Фон блока',{exact:true}).waitFor();
    await page.getByLabel('Добавить фото или видео в сцену файлов',{exact:true}).setInputFiles({name:'car.webp',mimeType:'image/webp',buffer:picture});await page.getByLabel('Подпись',{exact:true}).waitFor();
    await page.getByRole('button', {name: 'Сохранить настройки', exact: true}).click(); await page.getByRole('status').filter({hasText: 'Настройки сайта сохранены'}).waitFor();
    assert.equal(saved.accountAppearance.customer.banner, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.accountAppearance.supplier.icon, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.affiliatesEnabled, true);assert.equal(saved.accountAppearance.customer.colorLight,'#bddaf7');assert.equal(saved.accountAppearance.customer.backgroundDark,'/api/site-media/'+'a'.repeat(64));assert.equal(saved.accountAppearance.customer.media[0].caption,'car');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({path: `${out}/settings-${width}-${theme}.png`, fullPage: true}); await page.close();
  }
  for (const width of [320,390,1440]) for (const theme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
    await page.goto(origin+'/login?scenes&header');await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
    assert.equal(await page.locator('.account-scenes').count(),1);
    if(width<761){await page.getByRole('button',{name:'Войти',exact:true}).click();const form=await page.locator('#account-login-form').boundingBox();const header=await page.locator('.ac-public-header').boundingBox();assert.ok(Math.abs(form.y-header.y-header.height)<=1,JSON.stringify({form,header}));assert.equal(await page.locator('.account-welcome').evaluate(el=>getComputedStyle(el).borderRadius),'28px');assert.equal(await page.locator('.account-welcome').evaluate(el=>getComputedStyle(el).overflow),'hidden');assert.ok(form.y+form.height<900,'whole login form is visible');await page.evaluate(()=>scrollTo(0,0));}
    for(const role of ['customer','dealer']){
      if(role!=='customer') await page.getByRole('button',{name:new RegExp({dealer:'Автодилер',blogger:'Автоблогер',supplier:'Автопоставщик'}[role])}).click();
      if(role==='dealer'){await (width<=760?page.locator('.dealer-inline-preview'):page.frameLocator('.entrance-dealer-preview iframe')).getByRole('heading',{name:'Top Avto',exact:true}).first().waitFor();await checkDealerPreview(page,width);assert.equal(await page.locator('.account-scenes').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);await page.screenshot({path:`${out}/dealer-preview-${width}-${theme}.png`,fullPage:true});continue;}
      await page.getByRole('button',{name:'Следующая сцена',exact:true}).click();
      assert.equal(await page.locator('.account-scene-controls button[aria-pressed=true]').innerText(),'2');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
      await page.screenshot({path:`${out}/scenes-${role}-${width}-${theme}.png`,fullPage:true});
      const count=await page.locator('.step-node').count();
      assert.equal(count,role==='customer'?6:role==='dealer'?5:4);
      const stageBox=await page.locator('.account-welcome').boundingBox();
      for(let n=0;n<count;n++){
        await page.locator('.step-node').nth(n).click();
        assert.equal(await page.locator('.step-node[aria-pressed=true]').innerText(),String(n+1));
        const nextBox=await page.locator('.account-welcome').boundingBox();assert.ok(Math.abs(stageBox.height-nextBox.height)<1,'scene height remains stable');assert.ok(Math.abs(stageBox.y-nextBox.y)<1,'scene top remains stable');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
        const clipped=await page.locator('.account-scenes .scene').evaluate(el=>{
          const outer=el.getBoundingClientRect();const child=el.firstElementChild.getBoundingClientRect();
          return child.height>outer.height+2 || child.width>outer.width+2;
        });
        if(clipped)await page.screenshot({path:`${out}/clipped-${role}-${n+1}-${width}-${theme}.png`,fullPage:true});
        assert.equal(clipped,false,`${role} scene ${n+1} must fit at ${width}/${theme}`);
        if((width===390||width===1440))await page.screenshot({path:`${out}/original-${role}-${n+1}-${width}-${theme}.png`,fullPage:true});
      }
      if(role==='customer'){
        await page.getByRole('button',{name:'4 звезды',exact:true}).click();assert.equal(await page.locator('.review-star.is-filled').count(),4);
        assert.equal(await page.getByRole('button',{name:'Пример публикации',exact:true}).count(),0);assert.equal(await page.locator('.review-rating strong').innerText(),'4,0');assert.equal(await page.locator('.review-dealer').count(),0);
      }
    }
    for(const role of ['Автоблогер','Автопоставщик']){await page.getByRole('button',{name:new RegExp(role)}).click();await page.getByText('Этот раздел ещё в разработке, скоро появится ;)',{exact:true}).waitFor();assert.equal(await page.locator('.account-scenes').count(),0);}await page.close();
  }
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});let saved;
    await page.route('**/api/auth/me',route=>route.fulfill({json:{user:null}}));
    await page.route('**/api/account/auth',route=>route.fulfill({json:{account:{id:'test',name:'Тестовый покупатель',phone:'+79990000000',avatarId:'character-1',avatarUrl:'/avatars/customers/character-1.svg'}}}));
    await page.route('**/api/account/portal',route=>route.fulfill({json:{clients:[]}}));
    await page.route('**/api/account/notifications',route=>route.fulfill({json:{items:[{id:'n1',title:'Можно оставить отзыв',text:'Договор подтверждён',at:'2026-10-05T00:00:00Z',href:'/account?tab=reviews'}]}}));
    await page.route('**/api/account/profile',route=>{saved=route.request().postDataJSON();return route.fulfill({json:{account:{id:'test',phone:'+79990000000',name:saved.name,avatarId:saved.avatarId,avatarUrl:'/avatars/customers/'+saved.avatarId+'.svg',telegramConnected:true}}});});
    await page.goto(origin+'/account?tab=profile');await page.getByRole('heading',{name:'Ваш профиль',exact:true}).waitFor();await page.locator('.customer-header-tools').waitFor();if(width<761)assert.equal(await page.locator('.ac-public-header a[href="/"]>div').isVisible(),true,'customer header keeps the site name visible');assert.equal(await page.locator('.account-avatar-grid button').count(),24);
    await page.getByRole('button',{name:'Назад',exact:true}).waitFor();
    const activeTab=page.getByRole('button',{name:'Профиль',exact:true});
    assert.equal(await activeTab.evaluate(el=>{const n=el.parentElement.getBoundingClientRect(),a=el.getBoundingClientRect();return a.left>=n.left-1&&a.right<=n.right+1;}),true,'active tab visible on entry');
    assert.equal(await activeTab.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 218, 98)');
    assert.ok((await page.locator('.customer-portal>header').boundingBox()).y>=(await page.locator('.ac-public-header').boundingBox()).height,'greeting is below fixed header');
    await page.getByLabel('Как к вам обращаться').fill('Антон');await page.getByRole('button',{name:'Женский портрет 2',exact:true}).click();await page.getByRole('button',{name:'Сохранить профиль',exact:true}).click();await page.getByRole('status').filter({hasText:'Профиль сохранён'}).waitFor();assert.equal(saved.avatarId,'character-12');await page.getByRole('heading',{name:'Здравствуйте, Антон'}).waitFor();
    await page.getByRole('button',{name:'Уведомления: 1',exact:true}).click();await page.getByText('Договор подтверждён',{exact:true}).waitFor();await page.getByRole('button',{name:'Прочитать все',exact:true}).click();await page.getByRole('button',{name:'Уведомления',exact:true}).waitFor();await page.screenshot({path:`${out}/profile-debug-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    await page.screenshot({path:`${out}/profile-notices-${width}.png`,fullPage:true});await page.close();
  }
  {
    const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'no-preference'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/login?scenes');
    await page.getByRole('button',{name:/Сцена 2:/}).click();await page.mouse.move(0,0);
    await page.locator('.contract-viewer.is-active').waitFor();
    await page.locator('.contract-signature.is-signing').waitFor();
    const identity=await page.locator('.contract-viewer').evaluate(el=>{window.savedContract=el;return true;});
    await page.locator('.contract-viewer').hover();await page.mouse.move(0,0);assert.equal(await page.locator('.contract-viewer').evaluate(el=>el===window.savedContract),identity,'hover preserves animated DOM');
    await page.locator('.contract-status.is-visible').waitFor();
    assert.equal(await page.locator('.contract-viewer-line.is-visible').count(),8);await page.locator('.scene-contract.is-complete').waitFor();assert.equal(await page.locator('.contract-viewer.is-active').count(),0);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.contract-handshake')).opacity==='1');
    await page.getByRole('button',{name:/Сцена 3:/}).click();await page.mouse.move(0,0);
    const before=await page.locator('.track-truck').evaluate(el=>el.getBoundingClientRect().left);
    await page.waitForTimeout(1000);
    const after=await page.locator('.track-truck').evaluate(el=>el.getBoundingClientRect().left);assert.ok(after>before+2,'car moves along original route');
    await page.locator('.track-arrival.is-visible').waitFor();
    await page.getByRole('button',{name:'Остановить смену сцен',exact:true}).click();
    await page.getByRole('button',{name:/Сцена 1:/}).click();
    assert.equal(await page.locator('.chat-msg').first().evaluate(el=>getComputedStyle(el).opacity),'1');
    await page.getByRole('button',{name:'Включить смену сцен',exact:true}).click();
    await page.getByRole('button',{name:/Сцена 6:/}).click();await page.mouse.move(0,0);await page.waitForTimeout(900);const firstRating=Number((await page.locator('.review-rating strong').innerText()).replace(',','.'));assert.ok(firstRating>0&&firstRating<5);await page.waitForTimeout(2900);assert.equal(await page.locator('.review-star.is-filled').count(),5);
    await page.getByRole('button',{name:/Сцена 5:/}).click();await page.mouse.move(0,0);await page.waitForTimeout(6900);assert.match(await page.locator('.notification-stream').getAttribute('style'),/translateY\(-/);await page.locator('.notif-item').filter({hasText:'Назначен личный менеджер'}).waitFor();
    assert.deepEqual(errors,[]);await page.close();
  }
  for(const width of [390,1440])for(const theme of ['light','dark']){
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    await page.goto(origin+'/login?scenes&media');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.getByRole('button',{name:/Сцена 4:/}).click();
    assert.equal(await page.locator('.media-tile:not([hidden])').count(),2);
    await page.waitForFunction(()=>document.querySelector('.media-tile video')?.readyState>=2);
    const photo=page.getByRole('button',{name:'Автомобиль перед отправкой',exact:true});await photo.click();
    const surface=width<761?page.locator('.entrance-media-dialog'):page.locator('.entrance-media-preview');
    await surface.waitFor({state:'visible'});assert.equal(await surface.locator('img').getAttribute('alt'),'Автомобиль перед отправкой');
    if(width>=761)assert.equal(await page.locator('#account-login-form').isVisible(),false);
    await page.screenshot({path:`${out}/media-${width}-${theme}.png`,fullPage:true});
    await surface.locator('h2').click();assert.equal(await page.locator('#account-login-form').isVisible(),true);
    await page.getByRole('button',{name:'Погрузка автомобиля',exact:true}).click();await surface.locator('video').waitFor();assert.equal(await surface.locator('video').getAttribute('controls'),'');
    await surface.locator('video').click({position:{x:30,y:30}});assert.equal(await surface.isVisible(),true,'player interaction keeps preview open');
    if(width<761)await page.mouse.click(2,2);else await page.locator('.account-entrance-heading').click();
    await surface.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Погрузка автомобиля',exact:true}).click();await surface.locator('video').waitFor();await page.keyboard.press('Escape');await surface.waitFor({state:'detached'});
    if(width>=761){await page.getByRole('button',{name:/Сцена 1:/}).click();await page.locator('.demo-stage').hover();await page.mouse.wheel(0,160);await page.waitForFunction(()=>document.querySelector('.step-node[aria-pressed=true]')?.textContent==='2');await page.mouse.wheel(0,160);assert.equal(await page.locator('.step-node[aria-pressed=true]').innerText(),'2','one wheel gesture advances once');}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);await page.close();
  }
  console.log(JSON.stringify({passed: true, widths: [390, 1440], themes: ['light', 'dark'], passwordConfirmation: true, rolePlaceholders: true, themeAndMediaUploads: true, settingsSaved: true, legacyStaffEntry: true}));
} finally {await browser.close(); await new Promise(r => server.close(r));}

// Exercise the real customer auth handlers after the visual fixture checks.
await import('./customer-auth.mjs');
