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
const out = "artifacts/offer-header";
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
    "public-price-sheet-fix.css",
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

try{for(const stock of [false,true])for(const theme of ['light','dark'])for(const width of [390,768,1440]){
 const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://yandex.ru/**',r=>r.fulfill({body:'<html><body>Карта</body></html>',contentType:'text/html'}));
 await page.goto(origin+'/cars/offer/special_dealer_topavto__vehicle?stock='+(stock?'1':'0'));await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await page.addStyleTag({content:'.ac-public-header{position:fixed!important;inset:0 0 auto;z-index:5000!important}'});
 const anchor=page.locator('.ac-offer-contact-anchor');await page.getByRole('button',{name:width<1280?'Оставить заявку':'Оставить заявку на расчёт',exact:true}).waitFor();
 if(width>=1280){assert.equal(await page.locator('.ac-offer-contact-floating').count(),0);await page.close();continue;}
 // Reproduce a containing/stacking context in the dealer's nested price column.
 await anchor.evaluate(n=>{const p=n.closest('[data-sticky-offer-column]');p.style.transform='translateZ(0)';p.style.isolation='isolate';});
 const top=await anchor.evaluate(n=>n.getBoundingClientRect().top+scrollY);
 await page.evaluate(y=>scrollTo({top:y+180,behavior:'instant'}),top);const floating=page.locator('.ac-offer-contact-floating');await floating.waitFor();
 const button=floating.getByRole('button',{name:'Оставить заявку',exact:true});
 assert.ok(await button.evaluate(n=>{const b=n.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===n;}),'header action must be the topmost clickable element');
 const bb=await button.boundingBox(),hb=await page.locator('.ac-public-header').boundingBox();
 assert.ok(width<768?bb.y>=hb.y&&bb.y+bb.height<=hb.y+hb.height+1:bb.y>=hb.y+hb.height,'mobile action occupies the header, tablet remains below');
 await page.screenshot({path:`${out}/header-${stock}-${theme}-${width}.png`});
 await button.click();await page.getByRole('dialog').filter({visible:true}).waitFor();await page.keyboard.press('Escape');
 if(width<768){await floating.getByRole('button',{name:'Закрыть панель заявки и показать шапку'}).click();await floating.waitFor({state:'detached'});assert.equal(await page.locator('.ac-public-header').evaluate(n=>n.inert),false);await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(100);await page.evaluate(y=>scrollTo({top:y+180,behavior:'instant'}),top);await floating.waitFor();}
 await floating.getByRole('button',{name:/Наверх к фото/}).click();await floating.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>scrollY),0);assert.deepEqual(errors,[]);await page.close();console.log(JSON.stringify({stock,theme,width,headerVisible:true,leadOpens:true,closeAndTop:true}));
}}finally{await browser.close();server.close();}
// Verify the installed release using real wheel scrolling on known dealer cards.
if(process.env.GITHUB_EVENT_NAME==='push')await import('./offer-header-live.mjs');
