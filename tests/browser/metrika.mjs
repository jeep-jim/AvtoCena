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
const out = "artifacts/metrika";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/metrika-fixture.tsx"],
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
      "tests/browser/metrika-fixture.tsx",
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers}/**/*.tsx",
    ],
  }),
]).process(
  publicCss +
    "\n@tailwind base;@tailwind components;@tailwind utilities;html{--ac-surface:#161b25;--ac-surface-2:#242b38;--ac-text:#fff;--ac-muted:#acb5c4;--ac-border:#3f4856;background:#090d16;color:#fff}html[data-theme=dark]{--ac-surface:#1b222c;--ac-surface-2:#303b4c;--ac-text:#fff;--ac-muted:#b8c0cd;--ac-border:#465368}",
  { from: undefined },
);
fs.writeFileSync(`${out}/app.css`, css.css);
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>';
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (["/", "/autocalc", "/cars", "/privacy/request"].includes(u.pathname)) {
    res.setHeader("Content-Type", "text/html");
    res.end(html);
    return;
  }
  const base = /^\/(buyers|pdf-flags|brands|avatars|logo)\//.test(u.pathname)
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
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||undefined,args:['--no-sandbox']});
const results=[];
try{
 for(const [width,theme] of [[390,'light'],[1440,'light'],[1440,'dark']]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.route('https://mc.yandex.ru/**',route=>route.fulfill({contentType:'text/javascript',body:`window.__ymCalls=window.__ymCalls||[];var q=window.ym?.a||[];window.ym=(...args)=>{window.__ymCalls.push(args);if(args[1]==='getClientID')args[2]('1234567890123456789');};for(var args of q)window.ym(...args);`}));
  const submitted=[];await context.route('**/api/leads',route=>{submitted.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});});
  const page=await context.newPage();
  await page.goto(origin+'/?utm_source=yandex&utm_campaign=987&yclid=123&phone=secret');
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.waitForFunction(()=>window.__ymCalls?.some(c=>c[1]==='init'));
  const calls=await page.evaluate(()=>window.__ymCalls);
  assert.equal(calls.filter(c=>c[1]==='init').length,1);
  assert.match(calls[0][2].url,/utm_source=yandex/);assert.match(calls[0][2].url,/yclid=123/);assert.doesNotMatch(calls[0][2].url,/phone|secret/);
  assert.equal(await page.locator('.ac-cookie-banner').count(),0);
  assert.equal(await page.locator('[role=dialog]').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_analytics_choice_v1')),null);
  await page.screenshot({path:out+'/initial-'+width+'.png',fullPage:true});
  const consent=page.getByRole('checkbox');
  assert.equal(await consent.count(),1);assert.equal(await consent.isChecked(),false);
  assert.equal(await page.locator('.ac-consent-mark').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  await page.getByRole('button',{name:'Отправить проверочную заявку'}).click();assert.equal(submitted.length,0);
  async function submit(){const response=page.waitForResponse(r=>r.url().endsWith('/api/leads'));await page.getByRole('button',{name:'Отправить проверочную заявку'}).click();await response;}
  await page.locator('.ac-consent-mark').click();assert.equal(await consent.isChecked(),true);await submit();assert.equal(submitted.at(-1).analyticsConsent,true);assert.equal(submitted.at(-1).attribution.metrikaClientId,'1234567890123456789');assert.equal(submitted.at(-1).attribution.yclid,'123');
  assert.equal(await page.evaluate(()=>window.__ymCalls.filter(c=>c[1]==='reachGoal'&&c[2]==='lead_submitted').length),1);
  assert.equal(await page.locator('.ac-consent-mark').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  await page.screenshot({path:out+'/consent-'+width+'-'+theme+'.png',fullPage:true});
  await page.getByRole('button',{name:'Настройки cookie',exact:true}).click();
  await page.getByRole('button',{name:'Отключить аналитику',exact:true}).click();
  await page.waitForFunction(()=>window.disableYaCounter112098062===true);
  assert.equal(await page.evaluate(()=>window.__ymCalls.at(-1)[1]),'destruct');
  await page.reload();await page.getByRole('button',{name:'Настройки cookie',exact:true}).waitFor();
  assert.equal(await page.locator('#yandex-metrika-112098062').count(),0);
  await page.getByRole('button',{name:'Настройки cookie',exact:true}).click();
  await page.getByRole('button',{name:'Включить статистику посещений',exact:true}).click();
  await page.waitForFunction(()=>window.__ymCalls?.some(c=>c[1]==='init'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('avtocena_analytics_choice_v1')),null);
  await page.evaluate(()=>{history.pushState({},'','/cars');window.dispatchEvent(new Event('avtocena:metrika-page'));window.dispatchEvent(new Event('avtocena:metrika-page'));});
  assert.equal(await page.evaluate(()=>window.__ymCalls.filter(c=>c[1]==='hit').length),1);
  await page.evaluate(()=>{history.pushState({},'','/privacy/request');window.dispatchEvent(new Event('avtocena:metrika-page'));});
  assert.equal(await page.evaluate(()=>window.__ymCalls.at(-1)[1]),'destruct');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(origin+'/?yclid=123');await page.getByRole('button',{name:'Настройки cookie',exact:true}).click();await page.getByRole('button',{name:'Отключить аналитику',exact:true}).click();await page.locator('.ac-consent-mark').click();await submit();assert.equal(submitted.at(-1).analyticsConsent,true);assert.equal(submitted.at(-1).attribution.metrikaClientId,'1234567890123456789');
  results.push({width,theme,singleConsent:true,whiteCheckbox:true,leadAttribution:true,newConsentAfterOldRefusal:true,immediateInit:true,noBanner:true,noFakeConsent:true,optOutAndReenable:true,spaDedup:true,privateExcluded:true});
  await context.close();
 }
 // Refusal while tag.js is downloading must clear pending initialization.
 const slow=await browser.newContext();let release;
 const gate=new Promise(resolve=>{release=resolve;});
 await slow.route('https://mc.yandex.ru/**',async route=>{await gate;await route.fulfill({contentType:'text/javascript',body:`window.__ymCalls=window.ym?.a||[];`});});
 const p=await slow.newPage();await p.goto(origin,{waitUntil:'domcontentloaded'});
 assert.equal(await p.locator('.ac-city-notice').count(),0);
 await p.getByRole('button',{name:'Настройки cookie',exact:true}).click();
 await p.getByRole('button',{name:'Отключить аналитику',exact:true}).click();
 release();await p.waitForFunction(()=>Array.isArray(window.__ymCalls));
 assert.equal(await p.evaluate(()=>window.__ymCalls.some(c=>c[1]==='init')),false);
 await slow.close();results.push({refusalDuringDownload:true});
 console.log(JSON.stringify(results));
}finally{await browser.close();server.close();}
