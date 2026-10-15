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
const out = "artifacts/dealer-market-orders";
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
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});let saved;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   if(route.request().url().endsWith('/market-quote')){
    const {offer:o}=route.request().postDataJSON();
    return route.fulfill({json:{key:JSON.stringify([o.market,o.currency,o.invoice,o.purchaseTotal,o.year,o.productionMonth,o.engineCc,o.powerHp,o.power30MinKw,o.fuel]),at:new Date().toISOString(),rate:85,input:{marketId:o.market,marketConfig:{logisticsRub:100000,topAvtoCommissionRub:90000,securityDepositRub:110000,percentExpenses:[]},sourcePriceRub:o.purchaseTotal*85,customsRub:200000,utilizationFeeRub:3400}}});
   }
   if(route.request().method()==='PUT'){const {base,...v}=route.request().postDataJSON();saved={...v,version:v.version+1};return route.fulfill({json:saved});}
   return route.fulfill({json:{total:0,items:[],models:[],choices:[]}});
  });
  await page.goto(origin);
  await page.evaluate(()=>{
   const make=(id,availability)=>({id,availability,status:'draft',make:'Toyota',model:id,trim:'',year:2026,productionMonth:1,engineCc:1987,powerHp:150,power30MinKw:0,fuel:'petrol',transmission:'CVT',drive:'Полный',body:'SUV',color:'Белый',steering:'left',mileageKm:0,description:'',equipment:'',photos:[{id:'p',url:'/buyers/1.jpg',caption:''}],priceUsd:34000,priceRub:3000000,officeId:'office',customsIncluded:true,customsExtraRub:0,personalUseEligible:true,defaultCity:'Новосибирск',updatedAt:'',market:'china',currency:'CNY',invoice:90000,purchaseTotal:100000});
   sessionStorage.setItem('fixture-server',JSON.stringify({offers:['order','market','stock'].flatMap(kind=>[make(kind+'1',kind),make(kind+'2',kind)]),specialsEnabled:true,stockEnabled:true,marketEnabled:true,marketHomeEnabled:false}));
  });
  await page.goto(origin+'?offer=market2');
  assert.equal(await page.getByRole('tab',{name:'Новые все страны',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByLabel('Рынок',{exact:true}).selectOption('japan');
  assert.equal(await page.getByLabel('Валюта рынка',{exact:true}).inputValue(),'JPY');
  await page.getByLabel('Валюта рынка',{exact:true}).selectOption('USD');
  await page.getByLabel('Цена продавца (инвойс)',{exact:true}).fill('20000');
  const priceSaved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON().offers.find(o=>o.id==='market2').purchaseTotal===23000);
  await page.getByLabel('Инвойс + расходы в стране покупки',{exact:true}).fill('23000');await priceSaved;
  assert.equal(saved.offers.find(o=>o.id==='market2').invoice,20000);
  assert.equal(saved.offers.find(o=>o.id==='market2').currency,'USD');
  await page.getByRole('heading',{name:'Структура цены',exact:true}).waitFor();
  const departureSaved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON().offers.find(o=>o.id==='market2').deliveryOriginCity==='Астрахань');
  await page.getByLabel('Город отправки по России',{exact:true}).selectOption('Астрахань');await departureSaved;
  await page.getByText('Доставка: Астрахань → Новосибирск',{exact:true}).waitFor();
  const toggled=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON().marketHomeEnabled===true);
  await page.getByRole('switch',{name:'Показывать на главной',exact:true}).click();await toggled;
  assert.equal(saved.marketEnabled,true);
  await page.getByLabel('Цена продавца (инвойс)',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-price-fields.png`});
  await page.getByRole('tab',{name:'Новые все страны',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/${width}-market-form.png`});
  for(const [kind,label] of [['market','Новые все страны'],['order','Новые одна страна'],['stock','В наличии']]){
   await page.getByRole('tab',{name:label,exact:true}).click();
   await page.getByRole('button',{name:new RegExp(kind+'2')}).click();
   const moved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.request().postDataJSON().offers.find(o=>o.id===kind+'2').position===1);
   await page.getByRole('button',{name:'Выше',exact:true}).click();await moved;
   assert.equal(saved.offers.find(o=>o.id===kind+'1').position,2);
  }
  await page.evaluate(v=>sessionStorage.setItem('fixture-server',JSON.stringify(v)),saved);
  await page.goto(origin+'?offer=market2');
  assert.equal((await page.getByLabel('Инвойс + расходы в стране покупки',{exact:true}).inputValue()).replace(/\s/g,''),'23000');
  assert.equal(await page.getByLabel('Город отправки по России',{exact:true}).inputValue(),'Астрахань');
  assert.equal(await page.getByRole('button',{name:'Выше',exact:true}).isDisabled(),true);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>{const s=JSON.parse(sessionStorage.getItem('fixture-server'));s.offers=s.offers.map(o=>({...o,status:'published'}));sessionStorage.setItem('fixture-server',JSON.stringify(s));});
  await page.goto(origin+'?view=market-rail');
  const rail=page.locator('[data-site-block="market-orders"]');await rail.waitFor();
  assert.equal(await rail.locator('h2').innerText(),'✨ Новые авто под заказ');
  assert.match(await rail.locator('h3').first().innerText(),/market2/);
  assert.equal(await page.locator('[data-site-block="specials"]').count(),1);assert.equal(await page.locator('[data-site-block="stock"]').count(),1);
  if(width>1000){const a=await rail.boundingBox(),b=await page.locator('[data-site-block="stock"]').boundingBox();assert.ok(a.y>b.y);const newCard=await rail.locator('a.ac-special-card').first().boundingBox(),oldCard=await page.locator('[data-site-block="stock"] a.ac-special-card').first().boundingBox();assert.ok(Math.abs(newCard.width-oldCard.width)<4);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${out}/${width}-three-rails.png`});
  assert.deepEqual(errors,[]);await page.close();console.log(width,'market fields, independent visibility, three-mode ordering, reload, third rail OK');
 }
}finally{await browser.close();server.close();}
