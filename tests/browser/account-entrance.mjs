import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import sharp from 'sharp';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = 'artifacts/account-entrance'; fs.mkdirSync(out, {recursive: true});
await build({entryPoints: ['tests/browser/account-entrance-fixture.tsx'], bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', outfile: `${out}/fixture.js`, define: {'process.env.NODE_ENV': '"production"', 'process.env': '{}'}, plugins: [{name: 'next', setup(b) {
  b.onResolve({filter: /^next\/(link|navigation)$/}, a => ({path: a.path, namespace: 'mock'}));
  b.onLoad({filter: /.*/, namespace: 'mock'}, a => ({contents: a.path === 'next/navigation' ? 'export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:()=>{},refresh:()=>{}});' : `import React from 'react';export default function Link(p){return React.createElement('a',p)}`, loader: 'jsx', resolveDir: process.cwd()}));
}}]});
const css = await postcss([tailwindcss({content: ['apps/web/components/**/*.tsx'], theme: {extend: {}}, plugins: []})]).process('@tailwind base;@tailwind components;@tailwind utilities;', {from: undefined});
const picture = await sharp({create: {width: 240, height: 280, channels: 4, background: '#4b654a'}}).webp().toBuffer();
const server = http.createServer((req, res) => {
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
      if (index > 2) await page.getByText('Регистрация для этой роли скоро откроется.').waitFor();
      else {await page.getByLabel('Логин', {exact: true}).fill('example'); await page.getByRole('button', {name: 'Показать пароль: Пароль', exact: true}).click(); assert.equal(await page.locator('input[name="accessKey"]').getAttribute('type'), 'text');}
    }
    await page.getByRole('button', {name: 'Пользователь', exact: true}).click(); assert.equal(await page.locator('.account-welcome-background').getAttribute('src'), '/api/site-media/' + '1'.repeat(64));
    await page.goto(origin + '/login?role=team'); await page.getByText('Вход в кабинет', {exact: true}).waitFor(); assert.equal(await page.getByText('Вход для команды', {exact: true}).count(), 0);
    let saved; await page.route('**/api/crm/site-media', route => route.fulfill({json: {url: '/api/site-media/' + 'a'.repeat(64)}}));
    await page.route('**/api/crm/public-features', route => {saved = route.request().postDataJSON(); return route.fulfill({json: {...saved, version: 1}});});
    await page.goto(origin + '/crm/site'); assert.equal(await page.locator('input[type="file"]').count(), 8);
    await page.getByLabel('Загрузить фон: Пользователь', {exact: true}).setInputFiles({name: 'banner.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Фон: Пользователь', {exact: true}).waitFor();
    await page.getByLabel('Загрузить иконку: АвтоПоставщик', {exact: true}).setInputFiles({name: 'icon.webp', mimeType: 'image/webp', buffer: picture});
    await page.getByAltText('Иконка: АвтоПоставщик', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Сохранить настройки', exact: true}).click(); await page.getByRole('status').filter({hasText: 'Настройки сайта сохранены'}).waitFor();
    assert.equal(saved.accountAppearance.customer.banner, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.accountAppearance.supplier.icon, '/api/site-media/' + 'a'.repeat(64)); assert.equal(saved.affiliatesEnabled, true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({path: `${out}/settings-${width}-${theme}.png`, fullPage: true}); await page.close();
  }
  console.log(JSON.stringify({passed: true, widths: [390, 1440], themes: ['light', 'dark'], passwordConfirmation: true, fourRoleBackgrounds: true, eightUploads: true, settingsSaved: true, legacyStaffEntry: true}));
} finally {await browser.close(); await new Promise(r => server.close(r));}
