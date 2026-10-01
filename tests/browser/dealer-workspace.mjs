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
const out = "artifacts/dealer-workspace";
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
        b.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({
          path: args.path,
          namespace: "mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents:
            args.path === "next/link"
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
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers,partners}/**/*.tsx",
    ],
  }),
]).process(
  publicCss +
    "\n@tailwind base;@tailwind components;@tailwind utilities;html{--ac-bg:#151c25;--ac-surface:#161b25;--ac-surface-2:#242b38;--ac-text:#fff;--ac-muted:#acb5c4;--ac-border:#3f4856;background:#090d16;color:#fff}html[data-theme=light]{--ac-bg:#edf1f6;--ac-surface:#fff;--ac-surface-2:#f0f2f5;--ac-text:#18212e;--ac-muted:#586374;--ac-border:#d3d9e2;background:#f5f6f8;color:#18212e}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}",
  { from: undefined },
);
fs.writeFileSync(`${out}/app.css`, css.css);
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (["/", "/autocalc"].includes(u.pathname)) {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  const base = /^\/(buyers|pdf-flags|brands|avatars|logo)\//.test(u.pathname) || u.pathname === "/favicon-round-v3.png"
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

try{
 for(const [width,theme] of [[390,'light'],[1440,'light'],[1440,'dark']]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],writes=[];let releaseMedia;let holdMedia=new Promise(r=>{releaseMedia=r;});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.route('**/api/**',async route=>{const u=route.request().url();if(u.includes('exchange-rate'))return route.fulfill({json:{quote:{value:84,quoteAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),source:'https://www.profinance.ru/chart/usdrub/'}}});if(u.includes('/knowledge'))return route.fulfill({json:{models:[],choices:[]}});if(u.includes('/media')){await holdMedia;return route.fulfill({json:{id:crypto.randomUUID(),url:'/buyers/1.jpg',caption:''}});}let body={};try{body=route.request().postDataJSON()||{};}catch{}writes.push({url:u,body});return route.fulfill({json:{...body,version:(body.version||0)+1}});});
  async function shot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(250);await page.screenshot({path:`${out}/${width}-${theme}-${name}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+name);}
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot('overview');assert.ok(await page.locator('.dealer-editor-navigation button').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth+1)),'menu labels fit buttons');
  await page.getByRole('button',{name:'Фото выдач',exact:true}).click();await page.getByRole('switch',{name:'Показывать фотографии покупателей'}).click();await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.getByText('Настройки сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.buyersEnabled,false);await shot('gallery');
  await page.getByRole('button',{name:'Автомобили',exact:true}).click();await page.getByRole('button',{name:'+ Добавить автомобиль',exact:true}).click();await page.getByLabel('Марка',{exact:true}).fill('Toyota');await page.getByLabel('Модель',{exact:true}).fill('RAV4');await page.getByLabel('Загрузить фотографии',{exact:true}).setInputFiles('apps/web/public/buyers/1.jpg');await page.getByRole('button',{name:'Загружаем фотографии…',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Загружаем фотографии…',exact:true}).isDisabled(),true);releaseMedia();await page.getByRole('status').filter({hasText:'Загружено: 1'}).waitFor();await shot('vehicle');
  await page.getByRole('button',{name:'Сохранить черновик автомобиля',exact:true}).click();await page.getByText('Черновик сохранён. Автомобиль не опубликован.',{exact:true}).waitFor();assert.equal(writes.at(-1).body.offers[0].status,'draft');
  const n=writes.length;await page.getByRole('switch',{name:'Включить демо',exact:true}).click();await page.getByRole('button',{name:'Страница компании',exact:true}).click();await page.getByLabel('Название компании',{exact:true}).fill('Демо правка');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.getByText('Демо сохранено в этой вкладке. Данные компаний не изменены.').waitFor();assert.equal(writes.length,n);await shot('demo');assert.equal(await page.locator('.crm-navigation').isVisible(),false);await page.getByRole('link',{name:'Предпросмотр',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Закрыть',exact:true}).click();assert.equal(writes.length,n);await page.getByRole('button',{name:'Пробный месяц · все функции'}).click();await page.getByRole('button',{name:'Автомобили',exact:true}).click();await page.getByText('Доступно с подпиской',{exact:true}).waitFor();assert.equal(writes.length,n);
  await page.goto(origin+'?view=platform');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot('platform');await page.getByRole('button',{name:'Тарифы и доступ',exact:true}).click();await shot('tariffs');await page.getByRole('button',{name:'Страницы сайта',exact:true}).click();await shot('pages');
  for(const kind of ['partners','knowledge']){await page.goto(origin+'?view='+kind);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot(kind);if(kind==='knowledge'){await page.getByRole('searchbox').fill('расчёт');assert.ok(await page.locator('.pw-article-link').count()>0);await page.locator('.pw-article-link').first().click();await page.locator('.pw-article').waitFor();} }
  assert.deepEqual(errors,[]);await page.close();console.log(width,theme,'workspace, save, gallery, isolated demo, plans, pages and knowledge search OK');
 }
 for(const lang of ['ru','en','zh','ja','ko','ar','de']){const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(origin+'?view=partners&lang='+lang);assert.equal(await page.locator('main').getAttribute('lang'),lang);assert.equal(await page.locator('main').getAttribute('dir'),lang==='ar'?'rtl':'ltr');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'locale overflow '+lang);if(lang==='ar')await page.screenshot({path:`${out}/arabic.png`,fullPage:true});await page.goto(origin+'?view=knowledge&lang='+lang);assert.equal(await page.locator('.pw-article-link').count(),7);await page.close();}
}finally{await browser.close();server.close();}
