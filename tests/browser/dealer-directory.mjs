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
const out = "artifacts/dealer-directory";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-directory-fixture.tsx"],
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
      "tests/browser/dealer-directory-fixture.tsx",
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
  if (["/", "/autocalc", "/knowledge", "/favorites", "/dealers"].includes(u.pathname)||u.pathname.startsWith("/cars/offer/")) {
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
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.addInitScript(()=>localStorage.setItem('avtocena_dealer_subscriptions',JSON.stringify([{version:1,dealerId:'dealer_topavto',name:'Топ Авто',href:'/nvkz/topavto',logoLight:'/brands/topavto-logo-black.png',logoDark:'/brands/topavto-logo.png'}])));
  await page.goto(origin+'/favorites');
  await page.getByRole('heading',{name:'Избранные дилеры'}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Каталоги'}).getByRole('link',{name:'Автомобили'}).getAttribute('href'),'/cars');
  for(const theme of ['light','dark']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await page.locator('.ac-dealer-logo-'+theme).isVisible(),true);
   assert.equal(await page.locator('.ac-dealer-logo-'+(theme==='light'?'dark':'light')).isVisible(),false);
  }
  await page.getByRole('navigation',{name:'Каталоги'}).getByRole('link',{name:'Автодилеры'}).click();
  await page.getByRole('heading',{name:'Автодилеры',exact:true}).waitFor();
  await page.getByRole('textbox',{name:'Поиск по городу'}).fill('новокуз');
  assert.equal(await page.getByRole('link',{name:/Топ Авто/}).count(),1);
  await page.getByRole('textbox',{name:'Поиск по городу'}).fill('Москва');
  await page.getByRole('heading',{name:'В этом городе пока нет дилеров'}).waitFor();
  await page.getByRole('button',{name:'Все компании'}).click();
  let attempts=0;
  await page.route('**/api/dealers/apply',async route=>{attempts++;const body=route.request().postData();assert.match(body,/dealer_directory/);assert.match(body,/Test Company/);await route.fulfill({status:attempts===1?500:200,contentType:'application/json',body:JSON.stringify({ok:attempts>1})});});
  for(const [name,value] of Object.entries({companyName:'Test Company',city:'Москва',contactName:'Тест',contact:'test@example.com'}))await page.locator('[name="'+name+'"]').fill(value);
  await page.locator('[name=consent]').check();
  await page.getByRole('button',{name:'Подать заявку',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Не удалось отправить'}).waitFor();
  await page.getByRole('button',{name:'Подать заявку',exact:true}).click();
  await page.getByRole('heading',{name:'Заявка отправлена'}).waitFor();
  for(const theme of ['light','dark']){
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:out+'/'+width+'-'+theme+'.png',fullPage:true});
  }
  await page.close();
 }
 console.log('PASS: favorites theme switch, directory links/city search, application retry/success, 390/1440 light/dark');
}finally{await browser.close();server.close();}
