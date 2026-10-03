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
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers,partners,leads,legal}/**/*.tsx",
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
  await page.screenshot({path:`${out}/profile-${width}-${theme}-${verified?'verified':'regular'}.png`});
  await page.getByRole('button',{name:/Открыть логотип/}).click();await page.locator('.dealer-logo-dialog[open]').waitFor();assert.equal(await page.locator('.dealer-logo-dialog .dealer-logo-verified').count(),verified?1:0);await page.screenshot({path:`${out}/logo-${width}-${theme}-${verified}.png`});await page.getByRole('button',{name:'Закрыть логотип'}).click();
  await page.getByRole('button',{name:'Отзывы',exact:true}).click();assert.ok(await page.getByText('Оценку и отзыв сможет оставить клиент, чья заявка подтверждена договором.',{exact:true}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.close();
 }
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let saved=null,media=0;
  await page.route('**/api/**',async r=>{const req=r.request();if(req.url().includes('/media')&&req.method()==='POST'){media++;return r.fulfill({json:{id:'banner-'+media,url:media===1?'/dealers/topavto-banner-v3.webp':'/buyers/2.jpg',caption:''}});}if(req.url().includes('/showcase')&&req.method()==='PUT'){const {base,...value}=req.postDataJSON();saved={...value,version:value.version+1};await page.evaluate(v=>sessionStorage.setItem('fixture-server',JSON.stringify(v)),saved);return r.fulfill({json:saved});}return r.fulfill({json:{}});});
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const preview=page.frameLocator('iframe[title="Мобильный предпросмотр дилера"]');await preview.locator('.dealer-profile').waitFor();await preview.locator('html').evaluate((el,t)=>{if(el.dataset.theme!==t)throw Error('Preview theme differs from editor');},theme);
  if(width===1440){const main=await page.locator('.dealer-editor-settings').boundingBox(),frame=await page.locator('.dealer-live-preview').boundingBox();assert.ok(frame.x>=main.x+main.width,'preview sits on the right');}
  assert.equal(await page.locator('.dealer-editor-sidebar .dealer-saved-button').count(),1);
  await page.getByRole('button',{name:'Страница компании',exact:true}).click();await page.getByLabel('Название компании',{exact:true}).fill('Компания Новое имя');await preview.getByRole('heading',{name:'Компания Новое имя',exact:true}).waitFor();
  await page.getByLabel('О компании',{exact:true}).fill('Новое описание, которое сразу показывается на мобильной странице.');await preview.locator('.dealer-intro').filter({hasText:'Новое описание, которое сразу показывается на мобильной странице.'}).waitFor();
  for(const name of ['Баннер для компьютера','Баннер для телефона'])await page.getByRole('region',{name,exact:true}).locator('input[type=file]').setInputFiles('apps/web/public/brands/topavto-logo-black.png');
  await page.waitForFunction(()=>{const value=JSON.parse(sessionStorage.getItem('fixture-server')||'null');return value?.bannerMobile==='/buyers/2.jpg'&&value?.banner==='/dealers/topavto-banner-v3.webp';});
  await preview.locator('.dealer-cover').evaluate(img=>img.decode());assert.ok((await preview.locator('.dealer-cover').evaluate(img=>img.currentSrc)).endsWith('/buyers/2.jpg'),'preview selects mobile source');
  await page.screenshot({path:`${out}/editor-profile-${width}-${theme}.png`});
  await page.reload();await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.getByRole('button',{name:'Страница компании',exact:true}).click();assert.equal(await page.getByLabel('Название компании',{exact:true}).inputValue(),'Компания Новое имя');assert.ok(await page.getByRole('region',{name:'Баннер для телефона',exact:true}).locator('img').count());
  await page.getByRole('button',{name:'Фото выдач',exact:true}).click();await preview.getByRole('heading',{name:'Жизнь компании',exact:true}).waitFor();
  await page.getByRole('button',{name:'Адреса',exact:true}).click();await page.getByLabel('Адрес',{exact:true}).fill('Новый адрес, 77');await preview.getByLabel('Адрес офиса в профиле',{exact:true}).locator('option').filter({hasText:'Новый адрес, 77'}).waitFor({state:'attached'});
  await page.screenshot({path:`${out}/editor-offices-${width}-${theme}.png`});
  await page.getByRole('button',{name:'Реквизиты',exact:true}).click();await page.getByLabel('Полное наименование ИП или организации',{exact:true}).fill('ООО Новые реквизиты');await preview.locator('.dealer-contact-sheet').getByText('ООО Новые реквизиты',{exact:true}).waitFor();await page.getByLabel('Банк',{exact:true}).fill('Закрытый банк');assert.equal(await preview.getByText('Закрытый банк',{exact:true}).count(),0);
  await page.screenshot({path:`${out}/editor-requisites-${width}-${theme}.png`});
  await page.getByRole('button',{name:'Каталог и рынки',exact:true}).click();await page.getByRole('checkbox').first().uncheck();assert.equal(await preview.locator('.dealer-contact-sheet .dealer-city-chips').getByText('Япония',{exact:true}).count(),0);await page.screenshot({path:`${out}/editor-markets-${width}-${theme}.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);console.log(`${width} ${theme}: profile geometry, live updates, two banners, reload, privacy and no overflow OK`);await page.close();
 }
} finally {await browser.close();server.close();}
