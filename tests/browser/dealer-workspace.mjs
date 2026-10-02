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

try{
 for(const width of [390,1440])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height:1050}});
  await page.route('https://yandex.ru/**',r=>r.fulfill({body:'<html><body>Карта</body></html>',contentType:'text/html; charset=utf-8'}));
  for(const stock of [false,true]){
   await page.goto(origin+'/cars/offer/special_dealer_topavto__vehicle?stock='+(stock?'1':'0'));
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.getByRole('heading',{name:'Toyota RAV4 2026 2.0L',exact:true}).waitFor();
   assert.equal(await page.locator('.dealer-vehicle-specs').count(),0);
   if(width===1440)assert.equal(await page.locator('[data-spec-desktop]').getAttribute('data-open'),'true');
   await page.getByText('Обновлено 02.10.2026, 15:00',{exact:true}).filter({visible:true}).waitFor();
   await page.locator('.ac-offer-updated summary').filter({visible:true}).click();
   assert.equal(await page.getByRole('link',{name:'Источник: ТопАвто →'}).filter({visible:true}).getAttribute('href'),'/nvkz/topavto');
   await page.getByRole('link',{name:'Профиль дилера ТопАвто'}).waitFor();
   await page.getByText('Другой автомобиль в наличии',{exact:true}).waitFor();
   if(width===390)assert.ok(await page.getByRole('button',{name:'Открыть фотографии автомобиля'}).evaluate(el=>Math.abs(el.clientHeight/el.clientWidth-.75)<.02));

   await page.getByLabel('Проверенный дилер',{exact:true}).waitFor();
   await page.getByText(stock?'Адрес автомобиля':'Офис дилера',{exact:true}).waitFor();
   await page.locator('.dealer-offer-identity iframe').waitFor();
   assert.match(await page.locator('.ac-offer-price-panel .ac-price').innerText(),/₽/);
   if(theme==='light')assert.equal(await page.locator('.ac-offer-price-panel').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(207, 229, 216)');
   if(!stock){await page.getByText('Структура цены',{exact:true}).waitFor();assert.ok(await page.locator('.ac-offer-price-panel').evaluate(el=>el.nextElementSibling?.classList.contains('ac-offer-breakdown')));}
   assert.equal(await page.getByRole('button',{name:'PDF текущей карточки',exact:true}).count(),0);
   await page.getByRole('button',{name:'Оставить заявку на расчёт',exact:true}).filter({visible:true}).click();
   await page.getByRole('dialog').waitFor();await page.getByRole('heading',{name:'Оставить заявку на автомобиль'}).waitFor();await page.waitForFunction(()=>!!history.state?.acOverlayStep);await page.goBack();await page.getByRole('dialog').waitFor({state:'detached'});
   await page.getByRole('button',{name:'Добавить в избранное',exact:true}).filter({visible:true}).click();
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('avtocena_favorites'))[0].dealerId),'dealer_topavto');
   await page.getByRole('button',{name:'Открыть фотографии автомобиля'}).click();
   await page.getByRole('button',{name:'Увеличить фото 1',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('[data-back-layer]'));
   await page.goBack();await page.locator('[data-back-layer]').waitFor({state:'detached'});
   await page.getByRole('button',{name:'Увеличить фото 1',exact:true}).waitFor();
   await page.goBack();await page.getByRole('dialog').waitFor({state:'detached'});
   await page.getByRole('button',{name:'Открыть фотографии автомобиля'}).click();
   await page.getByRole('button',{name:'Закрыть галерею',exact:true}).click();
   await page.waitForFunction(()=>!history.state?.acOverlayStep);
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:`${out}/${width}-${theme}-public-${stock?'stock':'order'}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'dealer card overflow');
   await page.evaluate(()=>localStorage.clear());
  }
  await page.goto(origin+'?view=profile');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.locator('.dealer-identity-title h1').filter({hasText:'ТопАвто'}).waitFor();
  assert.equal(await page.getByText('На АвтоЦене',{exact:true}).count(),0);
  assert.equal(await page.locator('.dealer-identity-row>.dealer-avatar').isVisible(),true);
  assert.ok(await page.locator('.dealer-avatar-centered').evaluate(el=>{const r=el.getBoundingClientRect(),sheet=document.querySelector('.dealer-profile-identity').getBoundingClientRect();return Math.abs(r.left+r.width/2-sheet.left-sheet.width/2)<2&&Math.abs(r.width-r.height)<1&&r.top<sheet.top&&r.bottom>sheet.top;}),'logo is circular, centered and crosses the banner seam');
  assert.ok(await page.evaluate(()=>scrollY<5),'profile opens at its banner');
  assert.equal(await page.locator('.dealer-profile-tabs button').count(),3);
  assert.equal((await page.locator('.dealer-profile-footer').innerText()).replace(/\n+/g,'\n'),'Исполнитель (дилер)\nООО Тестовый дилер\nЮридический адрес\nНовокузнецк, Пример адреса\nИНН\n7707083893\nОГРН\n1027700132195');
  assert.equal(await page.getByText('Скрытый банк',{exact:true}).count(),0);
  assert.ok(!(await page.locator('body').innerText()).includes('40802810926710009905'));
  await page.getByLabel('Проверенный дилер',{exact:true}).click();await page.getByText('Проверенный дилер — компания прошла проверку АвтоЦены.',{exact:true}).waitFor();
  assert.ok(await page.locator('.dealer-verification>span').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'verification explanation fits the screen');
  await page.getByRole('button',{name:'Информация о компании',exact:true}).click();await page.locator('dialog[open] .dealer-about-logo').waitFor();
  await page.waitForFunction(()=>!!history.state?.acOverlayStep);await page.goBack();await page.locator('dialog[open]').waitFor({state:'detached'});
  await page.getByRole('button',{name:'Контакты',exact:true}).click();await page.locator('.dealer-tab-content .dealer-about-logo').waitFor();
  await page.getByLabel('Адрес офиса в профиле',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/${width}-${theme}-public-contacts.png`,fullPage:true});
  await page.goBack();await page.locator('.dealer-profile-tabs button[aria-pressed=true]').filter({hasText:'Каталог'}).waitFor();
  await page.getByRole('button',{name:'Отзывы',exact:true}).click();await page.getByRole('heading',{name:'Отзывы о ТопАвто',exact:true}).waitFor();
  await page.screenshot({path:`${out}/${width}-${theme}-public-reviews.png`,fullPage:true});
  await page.goBack();await page.locator('.dealer-profile-tabs button[aria-pressed=true]').filter({hasText:'Каталог'}).waitFor();
  await page.getByRole('button',{name:'Информация о компании',exact:true}).click();
  await page.waitForFunction(()=>!!history.state?.acOverlayStep);
  await page.evaluate(()=>{history.pushState({},'', '/request?dealer=dealer_topavto');document.querySelector('dialog[open]').close();});
  await page.goBack();await page.waitForFunction(()=>location.search==='?view=profile'&&!history.state?.acOverlayStep);
  await page.waitForFunction(()=>{const img=document.querySelector('.dealer-stories img');return img?.complete&&img.naturalWidth>0;});
  if(width===390)assert.equal(await page.locator('.dealer-stories .ac-buyers-rail>button').first().evaluate(el=>el.clientHeight),110);
  await page.screenshot({path:`${out}/${width}-${theme}-public-profile.png`,fullPage:true});
  await page.goto(origin+'/cars/offer/special_dealer_topavto__vehicle?staff=1&verified=0');
  await page.getByRole('button',{name:'PDF текущей карточки',exact:true}).filter({visible:true}).waitFor();assert.equal(await page.getByLabel('Проверенный дилер',{exact:true}).count(),0);
  await page.evaluate(()=>localStorage.setItem('avtocena_favorites',JSON.stringify([{id:'special_dealer_topavto__vehicle',dealerName:'ТопАвто',title:'Toyota RAV4',price:3000000},{id:'special_other__vehicle',dealerName:'Другой дилер',title:'Honda Fit',price:1500000},{id:'catalog_vehicle',title:'Kia Sportage',price:2200000}])));
  await page.goto(origin+'/favorites');await page.getByRole('button',{name:'Оставить заявку',exact:true}).click();
  await page.getByLabel('Дилер для заявки',{exact:true}).selectOption('dealer_topavto');
  assert.equal(await page.locator('.ac-lead-favorites-list button').count(),2);
  await page.locator('.ac-lead-favorites-list button').first().click();
  await page.getByLabel('Дилер для заявки',{exact:true}).selectOption('other');
  assert.equal(await page.locator('.ac-lead-favorites-list button').count(),1);assert.equal(await page.locator('.ac-lead-favorites-list button[aria-pressed=true]').count(),0);
  await page.screenshot({path:`${out}/${width}-${theme}-favorites-dealer.png`,fullPage:true});await page.close();
 }
 for(const [width,theme] of [[390,'light'],[1440,'light'],[1440,'dark']]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],writes=[];let releaseMedia;let holdMedia=new Promise(r=>{releaseMedia=r;});page.on('pageerror',e=>errors.push(e.message));let acceptDelete=true;page.on('dialog',d=>acceptDelete?d.accept():d.dismiss());
  await page.route('**/api/**',async route=>{const u=route.request().url();if(u.includes('exchange-rate'))return route.fulfill({json:{quote:{value:84,quoteAt:new Date().toISOString(),fetchedAt:new Date().toISOString(),source:'https://www.profinance.ru/chart/usdrub/'}}});if(u.includes('/knowledge'))return route.fulfill({json:{models:[],choices:[]}});if(u.includes('/media')){await holdMedia;return route.fulfill({json:{id:crypto.randomUUID(),url:'/buyers/1.jpg',caption:''}});}let body={};try{body=route.request().postDataJSON()||{};}catch{}writes.push({url:u,body});const {base,...value}=body;return route.fulfill({json:{...value,version:(body.version||0)+1}});});
  async function shot(name){await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(250);await page.screenshot({path:`${out}/${width}-${theme}-${name}.png`,fullPage:true});if(theme==='light'&&['vehicle','stock'].includes(name))console.log('VISUAL_'+width+'_'+name+':'+(await page.screenshot({type:'jpeg',quality:65})).toString('base64'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow '+name);}
  await page.goto(origin+'?view=specs');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.getByText('От 5 дней — автомобиль у вас дома',{exact:true}).waitFor();assert.ok(await page.locator('.ac-offer-spec-tile').first().evaluate(el=>{const css=getComputedStyle(el);return css.borderTopWidth==='1px'&&css.backgroundColor!=='rgba(0, 0, 0, 0)';}));await shot('public-specs');
  await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot('overview');assert.ok(await page.locator('.dealer-editor-navigation button').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth+1)),'menu labels fit buttons');
  await page.getByRole('button',{name:'Фото выдач',exact:true}).click();await page.getByRole('switch',{name:'Показывать фотографии покупателей'}).click();await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.buyersEnabled,false);await shot('gallery');assert.equal(await page.locator('.dealer-editor-toolbar').evaluate(el=>getComputedStyle(el).position),'static');
  await page.getByRole('button',{name:'Автомобили',exact:true}).click();await page.getByRole('button',{name:'Добавить автомобиль',exact:true}).click();await page.getByLabel('Марка',{exact:true}).fill('Toyota');await page.getByLabel('Модель',{exact:true}).fill('RAV4');await page.getByLabel('Загрузить фотографии',{exact:true}).setInputFiles('apps/web/public/buyers/1.jpg');await page.getByRole('status').filter({hasText:'Загружаем фотографии…'}).waitFor();assert.equal(await page.getByRole('button',{name:'+ Авто по этому шаблону',exact:true}).isDisabled(),true);releaseMedia();await page.getByRole('status').filter({hasText:'Загружено: 1'}).waitFor();await shot('vehicle');
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.offers[0].status,'draft');
  if(width>=1280){const layout=await page.locator('.dealer-editor-layout').boundingBox(),actions=await page.locator('.dealer-offer-actions').boundingBox(),mode=await page.locator('.dealer-offer-mode-row').boundingBox();assert.ok(actions.x>mode.x+mode.width,'actions sit to the right');assert.ok(Math.abs(actions.y-layout.y)<2,'actions align with mode switch');assert.ok(await page.locator('.dealer-editor-sidebar .dw-demo-button').count()===1);}
  await page.getByLabel('Статус автомобиля',{exact:true}).selectOption('sold');assert.equal(await page.getByLabel('Статус',{exact:true}).inputValue(),'sold');await page.getByLabel('Статус',{exact:true}).selectOption('draft');assert.equal(await page.getByLabel('Статус автомобиля',{exact:true}).inputValue(),'draft');
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();await page.getByRole('button',{name:'Сохранено',exact:true}).waitFor();
  await page.getByLabel('Куда',{exact:true}).fill('Красноярск');await page.getByText(/Ориентировочно:.*\$/).waitFor();
  assert.equal(await page.getByRole('link',{name:/Источник: Форекс/}).getAttribute('href'),'https://www.profinance.ru/chart/usdrub/');
  await page.getByRole('switch',{name:'Автоматически обновлять курс USD/RUB'}).click();assert.equal(await page.getByLabel('Курс USD/RUB',{exact:true}).isDisabled(),false);
  await page.getByLabel('Курс USD/RUB',{exact:true}).fill('80');await page.getByLabel('К курсу, ₽',{exact:true}).fill('2.5');assert.ok(await page.locator('.dealer-rate-total').innerText().then(t=>t.includes('82,5')));
  await page.getByRole('button',{name:'Обновить курс',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dealer-rate-total').innerText.includes('86,5'));assert.equal(await page.getByLabel('Курс USD/RUB',{exact:true}).isDisabled(),true);
  await page.locator('.dealer-route-price input').fill('1050');await page.getByText('По тарифу: 1 050 $ · 5–10 дней',{exact:true}).waitFor();await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.pricing.tariffs.find(t=>t.city==='Красноярск').usd,1050);
  await page.getByRole('button',{name:'Добавить город доставки',exact:true}).click();await page.getByLabel('Новый город доставки',{exact:true}).fill('Томск');await page.getByLabel('Точный тариф, $',{exact:true}).fill('950');assert.ok(writes.at(-1).body.pricing.tariffs.every(t=>t.city));
  await page.getByRole('button',{name:'Добавить тариф',exact:true}).click();await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.pricing.tariffs.find(t=>t.city==='Томск').usd,950);
  await page.getByLabel('Статус автомобиля',{exact:true}).selectOption('published');assert.equal(await page.getByLabel('Статус',{exact:true}).inputValue(),'draft');await page.getByText(/Для публикации Toyota RAV4 заполните:/).waitFor();
  await page.getByRole('switch',{name:'Подзаголовок',exact:true}).click();await page.getByLabel('Подзаголовок ленты',{exact:true}).fill('От 5 дней — автомобиль у вас дома');assert.equal(await page.getByLabel('Подзаголовок ленты',{exact:true}).getAttribute('maxlength'),'70');await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.specialSubtitleEnabled,true);
  await page.getByRole('switch',{name:'Подзаголовок',exact:true}).click();assert.equal(await page.getByLabel('Подзаголовок ленты',{exact:true}).count(),0);await page.getByRole('switch',{name:'Подзаголовок',exact:true}).click();assert.equal(await page.getByLabel('Подзаголовок ленты',{exact:true}).inputValue(),'От 5 дней — автомобиль у вас дома');
  await shot('pricing');
  assert.equal(await page.locator('.dealer-knowledge-fold').getAttribute('open'),null);await page.locator('.dealer-knowledge-fold > summary').click();assert.notEqual(await page.locator('.dealer-knowledge-fold').getAttribute('open'),null);
  assert.equal(await page.locator('.dealer-offer-fields > details').nth(1).getAttribute('data-complete'),'true');
  if(width>=1280){assert.equal(await page.locator('.dealer-offer-aside').evaluate(el=>getComputedStyle(el).position),'sticky');await page.evaluate(()=>window.scrollTo(0,600));const box=await page.locator('.dealer-offer-aside').boundingBox();assert.ok(Math.abs(box.y-145)<2,'right column remains below header');await page.evaluate(()=>window.scrollTo(0,0));}
  await page.getByRole('tab',{name:'Автомобили в наличии',exact:true}).click();assert.equal(await page.locator('.dealer-offer-tile[aria-pressed]').count(),0);assert.ok(await page.locator('.dealer-offer-mode').evaluate(el=>{const active=el.querySelector('[aria-selected=true]');return getComputedStyle(el).borderTopWidth==='0px'&&Number(getComputedStyle(active).zIndex)>Number(getComputedStyle(el,'::before').zIndex);}),'active tab covers the frame');
  await page.getByRole('button',{name:'Добавить автомобиль',exact:true}).click();
  await page.getByLabel('Марка',{exact:true}).fill('Honda');await page.getByLabel('Модель',{exact:true}).fill('Fit');await page.getByLabel('Год выпуска',{exact:true}).fill('2021');await page.getByLabel('Состояние',{exact:true}).selectOption('used');await page.getByLabel('Цена автомобиля, ₽',{exact:true}).fill('1250000');await page.getByLabel('Пробег, км',{exact:true}).fill('42000');
  assert.equal(await page.getByLabel('Цена автомобиля, $',{exact:true}).count(),0);assert.equal(await page.getByLabel('Месяц производства (1–12)',{exact:true}).count(),0);assert.equal(await page.getByLabel('Таможенные платежи включены в закупочную цену').count(),0);
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.offers[1].availability,'stock');assert.equal(writes.at(-1).body.offers[1].priceRub,1250000);assert.equal(writes.at(-1).body.offers[1].condition,'used');
  await shot('stock');await page.getByRole('button',{name:'+ Авто по этому шаблону',exact:true}).click();await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.offers.length,3);assert.equal(writes.at(-1).body.offers[2].status,'draft');assert.notEqual(writes.at(-1).body.offers[1].id,writes.at(-1).body.offers[2].id);
  acceptDelete=false;await page.getByRole('button',{name:'Удалить автомобиль',exact:true}).click();assert.equal(await page.locator('.dealer-offer-tile[aria-pressed]').count(),2,'cancel keeps both stock cars');acceptDelete=true;
  await page.getByRole('button',{name:'Удалить автомобиль',exact:true}).click();await page.getByText('Все изменения сохранены',{exact:true}).waitFor();assert.equal(writes.at(-1).body.offers.length,2);
  await page.getByRole('tab',{name:'Новые автомобили под заказ',exact:true}).click();assert.equal(await page.getByLabel('Марка',{exact:true}).inputValue(),'Toyota');
  await page.getByRole('button',{name:'Реквизиты',exact:true}).click();
  await page.getByLabel('Полное наименование ИП или организации',{exact:true}).fill('ООО Компания дилера');
  await page.getByLabel('ИНН',{exact:true}).fill('7707083893');
  await page.getByLabel('ОГРН / ОГРНИП',{exact:true}).fill('1027700132195');
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();
  assert.equal(writes.at(-1).body.requisites.legalName,'ООО Компания дилера');
  assert.equal(writes.at(-1).body.requisites.inn,'7707083893');
  await page.evaluate(value=>sessionStorage.setItem('fixture-server',JSON.stringify(value)),writes.at(-1).body);
  await shot('requisites');await page.reload();await page.getByRole('button',{name:'Реквизиты',exact:true}).click();
  assert.equal(await page.getByLabel('ИНН',{exact:true}).inputValue(),'7707083893');
  const n=writes.length;await page.getByRole('switch',{name:'Посмотреть демо',exact:true}).click();await page.getByRole('button',{name:'Страница компании',exact:true}).click();await page.getByLabel('Название компании',{exact:true}).fill('Демо правка');await page.getByText('Изменения демо запоминаются в этой вкладке.').waitFor();assert.equal(writes.length,n);await shot('demo');assert.equal(await page.locator('.crm-navigation').isVisible(),false);await page.getByRole('button',{name:'Предпросмотр',exact:true}).click();await page.getByRole('dialog').waitFor();assert.notEqual(await page.getByRole('dialog').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');await shot('preview');await page.waitForFunction(()=>!!history.state?.acOverlayStep);await page.goBack();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(writes.length,n);await page.getByRole('button',{name:'Пробный месяц · все функции'}).click();await page.getByRole('button',{name:'Автомобили',exact:true}).click();await page.getByText('Доступно с подпиской',{exact:true}).waitFor();assert.equal(writes.length,n);await page.getByRole('button',{name:'Базовый доступ',exact:true}).click();await page.getByRole('button',{name:'Страница компании',exact:true}).click();assert.equal(await page.getByLabel('Название компании',{exact:true}).inputValue(),'Демо правка');
  await page.getByRole('switch',{name:'Выйти из демо',exact:true}).click();await page.getByRole('button',{name:'Автомобили',exact:true}).click();assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'RAV4');await page.getByRole('tab',{name:'Автомобили в наличии',exact:true}).click();assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'Fit');assert.equal(await page.getByLabel('Цена автомобиля, ₽',{exact:true}).inputValue(),'1250000');assert.equal(writes.length,n);
  await page.goto(origin+'?view=platform');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot('platform');await page.getByRole('button',{name:'Тарифы и доступ',exact:true}).click();await shot('tariffs');await page.getByRole('button',{name:'Страницы сайта',exact:true}).click();await shot('pages');
  for(const kind of ['partners','knowledge']){await page.goto(origin+'?view='+kind);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await shot(kind);if(kind==='knowledge'){await page.getByRole('searchbox').fill('расчёт');assert.ok(await page.locator('.pw-kb-group li a').count()>0);await page.locator('.pw-kb-group li a').first().click();await page.locator('.pw-article').waitFor();} }
  assert.deepEqual(errors,[]);await page.close();console.log(width,theme,'workspace, save, gallery, isolated demo, plans, pages and knowledge search OK');
 }
 // Saving must preserve later keystrokes, survive reload, and recover from errors.
 {
  const page=await browser.newPage();page.on('dialog',d=>d.accept());let saved=null,writes=0,fail=false,releaseSave;
  let gate=null;
  await page.route('**/api/**',async route=>{
   if(route.request().method()!=='PUT')return route.fulfill({json:{}});
   writes++;const {base,...body}=route.request().postDataJSON();
   if(gate){const pending=gate;gate=null;await pending;}
   if(fail)return route.fulfill({status:503,json:{error:'Соединение прервано'}});
   saved={...body,version:(body.version||0)+1};
   await page.evaluate(value=>sessionStorage.setItem('fixture-server',JSON.stringify(value)),saved);
   await route.fulfill({json:saved});
  });
  await page.goto(origin);
  await page.evaluate(()=>sessionStorage.setItem('avtocena_dealer_draft_dealer_topavto',JSON.stringify({value:{dealerId:'dealer_topavto',name:'Устаревшая копия'}})));
  await page.reload();await page.getByRole('button',{name:'Страница компании',exact:true}).click();
  assert.equal(await page.getByText('Есть несохранённые изменения из прошлой сессии.').count(),0);
  assert.equal(writes,0,'opening editor does not publish changes');
  gate=new Promise(r=>{releaseSave=r;});
  await page.getByLabel('Название компании',{exact:true}).fill('Первая правка');
  await page.getByText('Сохраняем…',{exact:true}).waitFor();
  await page.getByLabel('Название компании',{exact:true}).fill('Последняя правка');
  releaseSave();
  await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('fixture-server')||'{}').name==='Последняя правка');
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();
  assert.equal(saved.name,'Последняя правка');assert.equal(writes,2);
  await page.reload();await page.getByRole('button',{name:'Страница компании',exact:true}).click();
  assert.equal(await page.getByLabel('Название компании',{exact:true}).inputValue(),'Последняя правка');
  fail=true;await page.getByLabel('Название компании',{exact:true}).fill('Повтор после ошибки');
  await page.getByRole('button',{name:'Повторить сохранение'}).waitFor();
  const failedWrites=writes;await page.waitForTimeout(1400);assert.equal(writes,failedWrites,'no failed-save loop');
  // Unsaved edits restore automatically, without a version-choice banner.
  await page.reload();fail=false;await page.getByRole('button',{name:'Страница компании',exact:true}).click();
  await page.getByText('Все изменения сохранены',{exact:true}).waitFor();
  assert.equal(saved.name,'Повтор после ошибки');
  assert.equal(await page.getByRole('button',{name:'Восстановить изменения'}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Сохранить изменения',exact:true}).count(),0);
  await page.close();console.log('Autosave: queued typing, reload, legacy copy and failure recovery OK');
 }
 for(const lang of ['ru','en','zh','ja','ko','ar','de']){const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(origin+'?view=partners&lang='+lang);assert.equal(await page.locator('main').getAttribute('lang'),lang);assert.equal(await page.locator('main').getAttribute('dir'),lang==='ar'?'rtl':'ltr');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'locale overflow '+lang);if(lang==='ar')await page.screenshot({path:`${out}/arabic.png`,fullPage:true});await page.goto(origin+'?view=knowledge&lang='+lang);assert.equal(await page.locator('.pw-kb-group li a').count(),7);await page.close();}
}finally{for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:`${out}/last-page-${page.viewportSize()?.width}.png`,fullPage:true}).catch(()=>{});await browser.close();server.close();}
