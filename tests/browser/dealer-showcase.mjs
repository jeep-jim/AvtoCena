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
const out = "artifacts/dealer-showcase";
fs.mkdirSync(out, { recursive: true });
await build({
  entryPoints: ["tests/browser/dealer-showcase-fixture.tsx"],
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
      "tests/browser/dealer-showcase-fixture.tsx",
      "apps/web/components/{catalog,sharing,layout,home,autocalc,dealers}/**/*.tsx",
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
  if (["/", "/autocalc"].includes(u.pathname)) {
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
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN,
  args: ["--no-sandbox"],
});
const results = [];
try {
  for (const [width,theme] of [[390,"dark"],[1440,"dark"],[1440,"light"]]) {
    const context = await browser.newContext({
        viewport: { width, height: 950 },
      }),
      page = await context.newPage();
    const errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let accept = true;
    page.on("dialog", (d) => (accept ? d.accept() : d.dismiss()));
    await page.route("**/api/crm/**", async (route) => {
      const body = route.request().postDataJSON();
      writes.push({ url: route.request().url(), body });
      return route.fulfill({ json: { ...body, version: body.version + 1 } });
    });
    await page.route("**/api/crm/dealers/*/media",route=>route.fulfill(route.request().postData().includes('photo-one')?{json:{id:"imported",url:"/buyers/1.jpg",caption:""}}:{status:400,json:{error:"Источник не отдал фото"}}));
    await page.route("https://example.com/photo-*",route=>route.fulfill({status:200,contentType:"image/jpeg",body:fs.readFileSync("apps/web/public/buyers/1.jpg")}));
    await page.route("**/api/dealers/exchange-rate",route=>route.fulfill({json:{quote:{value:84,quoteAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),source:"https://www.profinance.ru/chart/usdrub/"},error:""}}));
    await page.route("**/api/autocalc/knowledge?**",route=>route.fulfill({json:{models:[],choices:[]}}));
    await page.route("**/api/autocalc",route=>route.fulfill({json:{url:"https://example.com/car",title:"Toyota RAV4",make:"Toyota",model:"RAV4",market:"",price:"34000",currency:"USD",draft:{year:"2025",productionMonth:"6",engineCc:"1998",powerHp:"150"},images:["https://example.com/photo-one.jpg","https://example.com/photo-two.jpg"],message:"Данные получены из объявления"}}));
    await page.goto(origin);
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page
      .getByRole("button", { name: "Фото покупателей", exact: true })
      .click();
    const gallery = page.getByRole("switch", {
      name: "Показывать фотографии покупателей",
    });
    assert.equal(await gallery.isChecked(), true);
    await gallery.uncheck();
    accept = false;
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    assert.equal(writes.length, 0);
    accept = true;
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Настройки сохранены" })
      .waitFor();
    assert.equal(writes[0].body.buyersEnabled, false);
    assert.equal(writes[0].body.buyerPhotos.length, 24);
    assert.equal(writes[0].body.specialsEnabled, false);
    await page
      .getByRole("button", { name: "Спецпредложения", exact: true })
      .click();
    await page.getByRole("button", { name: "+ Добавить автомобиль" }).click();
    await page.getByLabel("Марка", { exact: true }).fill("Toyota");
    await page.getByLabel("Модель", { exact: true }).fill("RAV4");
    await page.getByLabel("Ссылка на объявление",{exact:true}).fill("https://example.com/car");
    await page.getByRole("button",{name:"Разобрать ссылку",exact:true}).click();
    await page.getByRole("button",{name:"Подставить данные и выбранные фото",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Загружено фото: 1. Не удалось загрузить 1"}).waitFor();
    assert.equal(await page.getByLabel("Год выпуска",{exact:true}).inputValue(),"2025");
    assert.equal(await page.getByLabel("Цена автомобиля, $",{exact:true}).inputValue(),"34000");
    assert.equal(await page.getByLabel("Доставка, $",{exact:true}).inputValue(),"900");
    await page.getByRole("region",{name:"Предпросмотр спецпредложения"}).getByText("Toyota RAV4",{exact:true}).waitFor();
    await page
      .getByRole("button", { name: "Сохранить настройки дилера" })
      .click();
    await page.getByRole("status").filter({hasText:/^Настройки сохранены$/}).waitFor();
    assert.equal(writes[1].body.offers[0].status, "draft");
    assert.equal(writes[1].body.offers[0].make, "Toyota");
    assert.equal(writes[1].body.offers[0].photos.length,1);
    await page.screenshot({
      path: `${out}/editor-${width}-${theme}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "ОСАГО и кредит", exact: true })
      .click();
    await page
      .getByRole("switch", { name: "Показывать ОСАГО и кредит" })
      .uncheck();
    await page
      .getByRole("button", { name: "Сохранить видимость сервисов" })
      .click();
    await page.getByRole("status").filter({hasText:/^Настройки сохранены$/}).waitFor();
    assert.equal(writes[2].body.affiliatesEnabled, false);
    const rail = page.getByRole("heading", { name: /СПЕЦ ПРЕДЛОЖЕНИЕ/ });
    await rail.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/rail-${width}-${theme}.png` });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      saveConfirmation: true,
      galleryPreserved: 24,
      draft: true,
      servicesOff: true,
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  server.close();
}
