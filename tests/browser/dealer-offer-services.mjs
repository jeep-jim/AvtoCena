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
const out = "artifacts/dealer-offer-services";
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


try {
 for(const width of [390,1440]) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  let saved;
  page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
  await page.route('**/api/**',async route=>{
   if(route.request().method()==='PUT') {
    const {base,...value}=route.request().postDataJSON();saved={...value,version:value.version+1};console.log('SAVE',JSON.stringify(saved.offers?.map(o=>({id:o.id,servicesOverride:o.servicesOverride}))),saved.pricing?.commissionRub);
    return route.fulfill({json:saved});
   }
   return route.fulfill({json:{total:0,items:[],models:[],choices:[]}});
  });
  await page.goto(origin);
  await page.evaluate(()=>{
   const make=(id,availability)=>({id,availability,status:'draft',make:'Toyota',model:id,trim:'',year:2026,productionMonth:1,engineCc:1987,powerHp:150,power30MinKw:0,fuel:'petrol',transmission:'CVT',drive:'Полный',body:'SUV',color:'Белый',steering:'left',mileageKm:0,description:'',equipment:'',photos:[],priceUsd:34000,priceRub:3000000,officeId:'office',customsIncluded:true,customsExtraRub:0,personalUseEligible:true,defaultCity:'Новосибирск',updatedAt:''});
   sessionStorage.setItem('fixture-server',JSON.stringify({offers:[make('first','order'),make('vehicle','order'),make('stock','stock')]}));
  });
  await page.goto(origin+'?offer=vehicle');
  await page.getByLabel('Модель',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'vehicle');
  const toggle=page.getByRole('switch',{name:'Применить только к этому авто',exact:true});
  await toggle.click();
  const customSaved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON()?.offers?.find(o=>o.id==='vehicle')?.servicesOverride?.commissionRub===12345);
  await page.getByLabel('Комиссия, ₽',{exact:true}).fill('12345');
  await page.screenshot({path:`${out}/${width}-before-save.png`});
  console.log('FORM',await toggle.getAttribute('aria-checked'),await page.getByLabel('Комиссия, ₽',{exact:true}).inputValue());
  await customSaved;
  assert.equal(saved.pricing.commissionRub,140000);
  assert.equal(saved.offers[0].servicesOverride,undefined);
  await page.evaluate(value=>sessionStorage.setItem('fixture-server',JSON.stringify(value)),saved);
  await page.reload();
  await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'true');
  assert.equal((await page.getByLabel('Комиссия, ₽',{exact:true}).inputValue()).replace(/\s/g,''),'12345');
  await toggle.scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-services.png`});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const resetSaved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON().offers[1].servicesOverride===null);
  await toggle.click();
  await resetSaved;
  assert.equal(await toggle.getAttribute('aria-checked'),'false');
  assert.equal((await page.getByLabel('Комиссия, ₽',{exact:true}).inputValue()).replace(/\s/g,''),'140000');
  await page.goto(origin+'?offer=stock');
  await page.getByLabel('Модель',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'stock');
  assert.equal(await page.getByRole('tab',{name:'В наличии',exact:true}).getAttribute('aria-selected'),'true');
  for(const stock of ['0','1']){
   await page.goto(origin+'/cars/offer/special_dealer_topavto__vehicle?stock='+stock+'&staff=1');
   const edit=page.getByRole('link',{name:'Редактировать объявление',exact:true});await edit.waitFor();
   assert.equal(await edit.evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
   await page.screenshot({path:`${out}/${width}-card-${stock}.png`});
   assert.equal(await edit.getAttribute('href'),'/?offer=vehicle');
   await edit.click();await page.getByLabel('Модель',{exact:true}).waitFor();
   assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'vehicle');
   await page.goto(origin+'/cars/offer/special_dealer_topavto__vehicle?stock='+stock);
   assert.equal(await page.getByRole('link',{name:'Редактировать объявление',exact:true}).count(),0);
  }
  await page.close();console.log(width,'services isolation, saved value, reset, direct editor selection, stock/order edit links OK');
 }
} finally {await browser.close();server.close();}
