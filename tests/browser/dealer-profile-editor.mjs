import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const out = "artifacts/dealer-profile-editor";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-workspace-fixture.tsx"],
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  outdir: out,
  entryNames: "fixture",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [
    {
      name: "next",
      setup(b) {
        b.onResolve({ filter: /^next\/(link|navigation|dynamic)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "next/dynamic" ? `export default function dynamic(){return ()=>null;}` : args.path === "next/link"
              ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
              : `export const usePathname=()=>window.location.pathname;export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({push:()=>{},replace:()=>{},prefetch:()=>{},back:()=>{}});`,
          loader: "jsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const publicCss =
  [
    "select-controls.css",
    "globals.css",
    "catalog-ui.css",
    "public-polish.css",
    "flat-ui.css",
    "public-regression-fixes.css",
  ]
    .map((f) => fs.readFileSync("apps/web/app/" + f, "utf8"))
    .join("\n") +
  "\n" +
  fs.readFileSync("apps/web/app/(crm)/crm-responsive.css", "utf8");
const css = await postcss([
  tailwindcss({
    content: [
      "tests/browser/dealer-workspace-fixture.tsx",
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers,partners,leads,legal,ui}/**/*.tsx",
      "apps/web/app/(public)/favorites/page.tsx",
    ],
  }),
]).process(
  publicCss +
    "\n@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#161b25;--ac-surface-2:#242b38;--ac-text:#fff;--ac-muted:#acb5c4;--ac-border:#3f4856;background:#090d16;color:#fff}html[data-theme=light]{--ac-surface:#fff;--ac-surface-2:#f0f2f5;--ac-text:#18212e;--ac-muted:#586374;--ac-border:#d3d9e2;background:#f5f6f8;color:#18212e}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}",
  { from: undefined },
);
fs.writeFileSync(`${out}/app.css`, css.css);
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (["/", "/autocalc", "/knowledge", "/favorites"].includes(u.pathname)||u.pathname.startsWith("/cars/offer/")) {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  const base = /^\/(buyers|pdf-flags|brands|avatars|logo|dealers)\//.test(u.pathname) || u.pathname === "/favicon-round-v3.png"
    ? path.resolve("apps/web/public")
    : path.resolve(out);
  const file = path.resolve(base, "." + u.pathname);
  if (
    !file.startsWith(base + path.sep) ||
    !fs.existsSync(file) ||
    !fs.statSync(file).isFile()
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    /\.m?js$/.test(file)
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".webp")
          ? "image/webp"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "application/octet-stream",
  );
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
});
try {
 if(!process.env.EDITOR_ONLY)for(const width of [390,1440])for(const theme of ['light','dark'])for(const verified of [true,false]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.goto(origin+'?view=profile&long=1&mobileBanner=1&verified='+(verified?'1':'0'));
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.getByRole('button',{name:'Развернуть описание'}).waitFor();await page.locator('.dealer-cover').evaluate(img=>img.decode());assert.ok((await page.locator('.dealer-cover').evaluate(img=>img.currentSrc)).endsWith(width===390?'/buyers/2.jpg':'/dealers/topavto-banner-v3.webp'),'device selects its cover');
  assert.equal(await page.locator('.dealer-profile-identity .dealer-primary').count(),0);
  assert.equal(await page.locator('.dealer-profile-metrics span').allTextContents().then(a=>a.join(',')),'Рейтинг,Предложения');
  assert.equal(await page.locator('.dealer-avatar-centered').evaluate(el=>el.classList.contains('is-verified')),verified);
  assert.ok(await page.locator('.dealer-intro').evaluate(el=>{const css=getComputedStyle(el);return css.textAlign==='left'&&el.clientHeight<=parseFloat(css.lineHeight)*2+1;}));
  assert.ok(await page.locator('.dealer-identity-title h1').evaluate(el=>{const r=el.getBoundingClientRect(),sheet=document.querySelector('.dealer-profile-identity').getBoundingClientRect();return Math.abs(r.x+r.width/2-sheet.x-sheet.width/2)<1;}));
  await page.getByRole('button',{name:'Развернуть описание'}).click();assert.ok(await page.locator('.dealer-intro').evaluate(el=>el.clientHeight>parseFloat(getComputedStyle(el).lineHeight)*2+1));await page.getByRole('button',{name:'Свернуть описание'}).click();
  assert.equal(await page.locator('.dealer-avatar-face img:visible').evaluate(el=>getComputedStyle(el).objectFit),'cover');
  assert.equal(await page.locator('.dealer-avatar-face').evaluate(el=>getComputedStyle(el).padding),'0px');
  await page.getByRole('heading',{name:'Наши фото и Автовыдачи',exact:true}).waitFor();
  await page.screenshot({path:`${out}/profile-${width}-${theme}-${verified?'verified':'regular'}.png`});
  await page.getByRole('button',{name:/Открыть логотип/}).click();await page.locator('.dealer-logo-dialog[open]').waitFor();assert.equal(await page.locator('.dealer-logo-dialog .dealer-logo-verified').count(),verified?1:0);await page.screenshot({path:`${out}/logo-${width}-${theme}-${verified}.png`});await page.getByRole('button',{name:'Закрыть логотип'}).click();
  await page.locator('.dealer-dock').getByRole('button',{name:'Отзывы',exact:true}).click();assert.ok(await page.getByText('Оценку и отзыв сможет оставить клиент, чья заявка подтверждена договором.',{exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();
 }
 if(!process.env.EDITOR_ONLY)for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width:390,height:850}});await page.route('**/api/**',r=>r.fulfill({json:{}}));
  await page.goto(origin+'?view=profile&multi=1&long=1#cars');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  assert.ok(await page.evaluate(()=>scrollY<5),'initial hash route still starts at cover');
  assert.deepEqual(await page.locator('.dealer-dock span').allTextContents(),['Каталог','Медиа','Адреса','Отзывы','Заявка']);
  await page.locator('.dealer-profile-hero .dealer-banner-dots button').nth(4).click();await page.locator('.dealer-profile-hero .dealer-cover').evaluate(img=>img.decode());assert.ok((await page.locator('.dealer-profile-hero .dealer-cover').evaluate(img=>img.currentSrc)).endsWith('/buyers/7.jpg'));
  await page.locator('.dealer-profile-hero').getByRole('button',{name:'Рассмотреть баннер'}).click();await page.locator('.dealer-banner-dialog[open]').waitFor();await page.getByRole('button',{name:'Предыдущий баннер'}).click();await page.getByRole('button',{name:'Закрыть баннер'}).click();
  const face=await page.locator('.dealer-avatar-face').evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(face,'rgb(209, 250, 229)');
  await page.locator('.dealer-dock').getByRole('button',{name:'Медиа',exact:true}).click();
  assert.ok(await page.locator('.dealer-photo-grid .ac-buyers-rail').evaluate(el=>el.getBoundingClientRect().width>300));
  assert.equal(await page.getByRole('dialog',{name:'Медиа',exact:true}).count(),1);
  await page.screenshot({path:`${out}/media-${theme}.png`});await page.getByRole('button',{name:'Закрыть медиа'}).click();
  await page.locator('.dealer-dock').getByRole('button',{name:'Отзывы',exact:true}).click();await page.getByText('Сообщение компании',{exact:true}).waitFor();await page.screenshot({path:`${out}/reviews-${theme}.png`});await page.getByRole('button',{name:'Закрыть отзывы'}).click();
  await page.locator('.dealer-dock').getByRole('button',{name:'Заявка',exact:true}).click();await page.locator('.ac-lead-dialog').waitFor();await page.screenshot({path:`${out}/request-${theme}.png`});assert.equal(await page.locator('.ac-lead-dialog form').count(),1);await page.keyboard.press('Escape');
  await page.goto(origin+'?view=profile&empty=1');await page.locator('.dealer-default-logo').first().evaluate(img=>img.decode());assert.ok((await page.locator('.dealer-profile-hero .dealer-cover').evaluate(img=>img.currentSrc)).endsWith('/dealers/default-cover.svg'));assert.equal(await page.getByText('Каталог компании',{exact:true}).count(),0);
  await page.close();
 }
 if(!process.env.EDITOR_ONLY)for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:950},hasTouch:true});let subscribed=false,count=2,fail=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async r=>{if(r.request().url().includes('/subscription')){if(r.request().method()==='PUT'){if(fail)return r.fulfill({status:503,json:{error:'Временная ошибка'}});const next=r.request().postDataJSON().subscribed;if(next!==subscribed)count+=next?1:-1;subscribed=next;}return r.fulfill({json:{count,subscribed}});}if(r.request().url().includes('brand-counts'))return r.fulfill({json:{counts:{Toyota:3,BMW:2,Audi:2,Honda:2,Mazda:1,Lexus:1,Nissan:1,Kia:1}}});return r.fulfill({json:{}});});
  await page.goto(origin+'?view=profile&interactive=1&long=1');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const subscribe=page.getByRole('button',{name:'Подписаться на дилера',exact:true});await subscribe.waitFor();await page.waitForFunction(()=>!document.querySelector('.dealer-subscription-control button').disabled);assert.equal(await page.locator('.dealer-cover-actions').count(),0);assert.equal(await page.locator('.dealer-profile-tabs').count(),0);
  await subscribe.click();await page.getByRole('button',{name:'Отписаться от дилера',exact:true}).waitFor();assert.equal(await page.locator('.dealer-subscription-control strong').textContent(),'3');
  await page.reload();await page.getByRole('button',{name:'Отписаться от дилера',exact:true}).waitFor();assert.equal(await page.locator('.dealer-subscription-control strong').textContent(),'3');
  await page.goto(origin+'?view=favorites');await page.getByRole('heading',{name:'Подписки на дилеров'}).waitFor();assert.equal(await page.locator('.ac-subscribed-dealers article').count(),1);await page.getByRole('button',{name:'Отписаться от ТопАвто',exact:true}).click();await page.locator('.ac-subscribed-dealers').waitFor({state:'detached'});assert.equal(count,2);
  await page.goto(origin+'?view=profile&interactive=1&long=1');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.waitForFunction(()=>!document.querySelector('.dealer-subscription-control button').disabled);fail=true;await page.getByRole('button',{name:'Подписаться на дилера',exact:true}).click();await page.getByText('Временная ошибка',{exact:true}).waitFor();assert.equal(await page.locator('.dealer-subscription-control strong').textContent(),'2');fail=false;
  const description=page.getByRole('button',{name:'Развернуть описание',exact:true});await description.click({position:{x:20,y:10}});await page.getByRole('button',{name:'Свернуть описание',exact:true}).click({position:{x:20,y:10}});
  for(const selector of ['.ac-currency-rates-strip','.ac-brand-rail[aria-label="Марки автомобилей"]']){const rail=page.locator(selector);await rail.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);await rail.hover();await page.mouse.wheel(0,180);await page.waitForTimeout(200);assert.ok(await page.evaluate(y=>scrollY>y+40,before),'vertical wheel scrolls page over '+selector);if(width===390){await rail.scrollIntoViewIfNeeded();const box=await rail.boundingBox(),start=await page.evaluate(()=>scrollY),cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+70,y:box.y+box.height/2}]});for(let i=1;i<=5;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+70,y:box.y+box.height/2-i*22}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);assert.ok(await page.evaluate(y=>scrollY>y+30,start),'touch scrolls page over '+selector);await cdp.detach();}}
  await page.getByRole('button',{name:'Показать все марки'}).click();await page.getByRole('dialog',{name:'Все марки автомобилей'}).waitFor();await page.waitForTimeout(250);await page.screenshot({path:`${out}/brands-${width}-${theme}.png`});await page.keyboard.press('Escape');await page.locator('.ac-public-sheet').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Открыть курс: Японская иена (JPY)'}).click();await page.getByRole('dialog',{name:'Курсы валют'}).waitFor();await page.keyboard.press('Escape');await page.locator('.ac-public-sheet').waitFor({state:'detached'});
  await page.locator('.dealer-profile-metrics button').nth(1).click();assert.equal(await page.locator('.dealer-car').count(),0);assert.equal(await page.locator('.dealer-main-offers a').count(),1);
  await page.locator('.dealer-dock').getByRole('button',{name:'Каталог',exact:true}).click();await page.waitForFunction(()=>scrollY<5);
  const tools=page.locator('.ac-public-footer-tools');assert.equal(await tools.getByRole('button',{name:'База знаний',exact:true}).isDisabled(),true);assert.equal(await tools.getByRole('button',{name:'АвтоРасчёт',exact:true}).count(),0);await tools.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/footer-${width}-${theme}.png`});await page.goto(origin+'?view=profile&interactive=1&knowledge=1');await page.locator('.ac-public-footer-tools').getByRole('link',{name:'База знаний',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await page.close();console.log(width,theme,'subscriptions, favorites, failure recovery, touch/wheel rails and shared sheets OK');
 }
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let saved=null,media=0;
  await page.route('**/api/**',async r=>{const req=r.request();if(req.url().includes('/media')&&req.method()==='POST'){media++;return r.fulfill({json:{id:'banner-'+media,url:media===1?'/dealers/topavto-banner-v3.webp':'/buyers/2.jpg',caption:''}});}if(req.url().includes('/showcase')&&req.method()==='PUT'){const {base,...value}=req.postDataJSON();saved={...value,version:value.version+1};await page.evaluate(v=>sessionStorage.setItem('fixture-server',JSON.stringify(v)),saved);return r.fulfill({json:saved});}return r.fulfill({json:{}});});
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const preview=page.frameLocator('iframe[title="Мобильный предпросмотр дилера"]');await preview.locator('.dealer-profile').waitFor();await preview.locator('html').evaluate((el,t)=>{if(el.dataset.theme!==t)throw Error('Preview theme differs from editor');},theme);
  if(width===1440){const main=await page.locator('.dealer-editor-settings').boundingBox(),frame=await page.locator('.dealer-live-preview').boundingBox();assert.ok(frame.x>=main.x+main.width,'preview sits on the right');}
  assert.equal(await page.locator('.dealer-editor-sidebar .dealer-saved-button').count(),1);
  await page.getByRole('button',{name:'Страница компании',exact:true}).click();await page.getByLabel('Название компании',{exact:true}).fill('Компания Новое имя');await preview.getByRole('heading',{name:'Компания Новое имя',exact:true}).waitFor();
  assert.equal(await page.locator('.dealer-live-preview>header').count(),0);
  assert.ok(await preview.locator('.dealer-cover').evaluate(el=>Math.abs(el.getBoundingClientRect().top)<1),'preview banner begins at viewport top');
  for(const [key,color] of [['logoLight','rgb(32, 38, 51)'],['logoDark','rgb(245, 247, 250)']]){const field=page.locator('.dealer-brand-'+key);assert.equal(await field.locator('h3').evaluate(el=>getComputedStyle(el).color),color);assert.equal(await field.locator('button').first().evaluate(el=>getComputedStyle(el).color),color);assert.equal(await field.locator('img').first().evaluate(el=>getComputedStyle(el).filter),'none');if(key==='logoDark')assert.equal(await field.locator('img').first().evaluate(el=>getComputedStyle(el).content),'normal');else assert.ok((await field.locator('img').first().evaluate(el=>getComputedStyle(el).content)).includes('topavto-logo-black.png'));}
  await page.locator('.dealer-brand-fields').first().screenshot({path:`${out}/brand-fields-${width}-${theme}.png`});
  await page.getByLabel('О компании',{exact:true}).fill('Новое описание, которое сразу показывается на мобильной странице.');await preview.locator('.dealer-intro').filter({hasText:'Новое описание, которое сразу показывается на мобильной странице.'}).waitFor();
  for(const name of ['Баннер для компьютера','Баннер для телефона'])await page.getByRole('region',{name,exact:true}).locator('input[type=file]').setInputFiles('apps/web/public/brands/topavto-logo-black.png');
  await page.waitForFunction(()=>{const value=JSON.parse(sessionStorage.getItem('fixture-server')||'null');return value?.bannerMobile==='/buyers/2.jpg'&&value?.banner==='/dealers/topavto-banner-v3.webp';});
  await preview.locator('.dealer-cover').evaluate(img=>img.decode());assert.ok((await preview.locator('.dealer-cover').evaluate(img=>img.currentSrc)).endsWith('/buyers/2.jpg'),'preview selects mobile source');
  await page.screenshot({path:`${out}/editor-profile-${width}-${theme}.png`});
  await page.reload();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.getByRole('button',{name:'Страница компании',exact:true}).click();assert.equal(await page.getByLabel('Название компании',{exact:true}).inputValue(),'Компания Новое имя');assert.ok(await page.getByRole('region',{name:'Баннер для телефона',exact:true}).locator('img').count());
  await page.getByRole('button',{name:'Фото выдач',exact:true}).click();await preview.getByRole('dialog',{name:'Медиа',exact:true}).waitFor();assert.ok(await preview.locator('.dealer-photo-grid .ac-buyers-rail').evaluate(el=>el.getBoundingClientRect().width>280));await page.screenshot({path:`${out}/editor-buyers-${width}-${theme}.png`});
  await page.getByRole('button',{name:'Адреса',exact:true}).click();await page.getByLabel('Адрес',{exact:true}).fill('Новый адрес, 77');await preview.getByLabel('Адрес офиса в профиле',{exact:true}).locator('option').filter({hasText:'Новый адрес, 77'}).waitFor({state:'attached'});
  await page.screenshot({path:`${out}/editor-offices-${width}-${theme}.png`});
  await page.getByRole('button',{name:'Реквизиты',exact:true}).click();await page.getByLabel('Полное наименование ИП или организации',{exact:true}).fill('ООО Новые реквизиты');await preview.locator('.dealer-contact-sheet').getByText('ООО Новые реквизиты',{exact:true}).waitFor();await page.getByLabel('Банк',{exact:true}).fill('Закрытый банк');assert.equal(await preview.getByText('Закрытый банк',{exact:true}).count(),0);
  await page.screenshot({path:`${out}/editor-requisites-${width}-${theme}.png`});
  await page.getByRole('button',{name:'Каталог и рынки',exact:true}).click();await page.getByRole('checkbox').first().uncheck();assert.equal(await preview.locator('.dealer-contact-sheet .dealer-city-chips').getByText('Япония',{exact:true}).count(),0);await page.screenshot({path:`${out}/editor-markets-${width}-${theme}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);console.log(`${width} ${theme}: profile geometry, live updates, two banners, reload, privacy and no overflow OK`);await page.close();
 }
} finally {await browser.close();server.close();}
