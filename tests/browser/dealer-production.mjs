import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import sharp from "sharp";
import { defaultShowcase } from "../../apps/web/lib/dealers/showcase-model.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = process.cwd(),
  dir = path.join(root, "apps/web/data"),
  out = path.join(root, "artifacts/dealer-production");
if (fs.existsSync(dir)) throw Error("Refusing to overwrite existing web data");
fs.mkdirSync(out, { recursive: true });
const write = (p, v) => {
  const file = path.join(dir, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v));
};
const actor = {
  id: "test-dealer",
  displayName: "Тестовый дилер",
  telegramUsername: "fixture_dealer",
  role: "dealer",
  companyId: "dealer_topavto",
  dealerApproved: true,
  status: "active",
  sessionVersion: 0,
};
const s = defaultShowcase("dealer_topavto");
s.profileEnabled = true;
s.specialsEnabled = true;
s.phone = "+70000000000";
s.description = "Тестовая компания — данные только локальной проверки";
s.offices = [
  {
    id: "office",
    city: "Новосибирск",
    address: "ул. Ленина, 1",
    phone: "",
    hours: "10:00–19:00",
    lat: 55.03,
    lon: 82.92,
    photos: [],
  },
];
s.pricing = {
  ...s.pricing,
  rateMode: "manual",
  usdRub: 80,
  rateAt: new Date().toISOString(),
  tariffs: [
    { id: "city", city: "Новосибирск", usd: 1000, daysFrom: 5, daysTo: 7 },
  ],
};
s.offers = [
  {
    id: "test-rav4",
    status: "published",
    make: "Toyota",
    model: "RAV4",
    trim: "Premium",
    year: 2026,
    productionMonth: 1,
    engineCc: 2000,
    powerHp: 150,
    power30MinKw: 0,
    fuel: "petrol",
    transmission: "Автомат",
    drive: "Полный",
    body: "Кроссовер",
    color: "Белый",
    steering: "left",
    mileageKm: 0,
    description: "Описание тестового автомобиля",
    equipment: "Подогрев сидений",
    photos: [{ id: "p", url: "/buyers/1.jpg", caption: "" }],
    priceUsd: 34000,
    customsIncluded: true,
    customsExtraRub: 0,
    personalUseEligible: true,
    defaultCity: "Новосибирск",
    updatedAt: new Date().toISOString(),
  },
];
write("auth/users.json", [actor]);
write("dealers/showcases/dealer_topavto.json", s);
write("settings/public-features.json", {
  version: 0,
  affiliatesEnabled: false,
});
const secret = crypto.randomBytes(32).toString("hex");
const encoded = Buffer.from(
  JSON.stringify({ ...actor, exp: Math.floor(Date.now() / 1000) + 3600 }),
).toString("base64url");
const cookie = `${encoded}.${crypto.createHmac("sha256", secret).update(encoded).digest("base64url")}`;
const log = fs.openSync(path.join(out, "server.log"), "w");
const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    "3099",
  ],
  {
    cwd: path.join(root, "apps/web"),
    env: { ...process.env, AUTH_SECRET: secret, JSON_STORAGE_DRIVER: "local" },
    stdio: ["ignore", log, log],
  },
);
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3099/api/health");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({ headless: true, executablePath:process.env.CHROME_BIN, args: ["--no-sandbox"] });
  const origin = "http://localhost:3099";
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 950 },
      }),
      page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("BROWSER", e.message);
    });
    await page.route("https://**/*", (route) => route.abort());
    await page.addInitScript(()=>{
      const add=document.addEventListener.bind(document);
      window.__dealerClickReady=false;
      document.addEventListener=(type,listener,options)=>{
        if(type==='click'&&String(listener).includes('data-offer-action'))window.__dealerClickReady=true;
        return add(type,listener,options);
      };
    });
    await page.goto(`${origin}/nvkz/topavto`);
    await page
      .getByRole("heading", { name: "TOP AVTO", exact: true })
      .waitFor();
    await page.screenshot({
      path: path.join(out, `dealer-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const response = await page.goto(
      `${origin}/cars/offer/special_dealer_topavto__test-rav4?dealer=dealer_topavto`,
    );
    assert.equal(response.status(), 200);
    assert.equal(await page.getByRole("link",{name:"Выйти на АвтоЦену"}).getAttribute("href"),"/cars");
    await page
      .getByRole("heading", { name: "Toyota RAV4 Premium", exact: true })
      .waitFor();
    assert.match(await page.locator(".ac-price").innerText(), /3\s135\s900/);
    assert.equal(await page.locator("main select").count(), 0);
    await page.screenshot({
      path: path.join(out, `offer-${width}.png`),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.equal(
      await page
        .locator('a[href^="https://affid.ru/"]')
        .evaluateAll(
          (els) =>
            els.filter((e) => e.getBoundingClientRect().height > 0).length,
        ),
      0,
    );
    const consent = page.getByText("Только необходимые", { exact: true });
    if (await consent.isVisible()) await consent.click();
    await page.waitForFunction(()=>window.__dealerClickReady===true);
    await page
      .locator("button[data-offer-action=lead]:visible")
      .first()
      .click();
    await page.getByRole("dialog").waitFor();
    await page
      .getByRole("dialog")
      .getByText("Toyota RAV4 Premium", { exact: false })
      .first()
      .waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  await context.addCookies([
    { name: "avtocena_session", value: cookie, url: origin },
  ]);
  const page = await context.newPage();
  page.on("response", async (r) => {
    if (r.url().includes("/api/crm/") && r.status() >= 400)
      console.error("API", r.status(), await r.text().catch(() => ""));
  });
  page.on("dialog", (d) => d.accept());
  await page.route("**/api/crm/**", (r) =>
    r.continue({
      headers: { ...r.request().headers(), origin: "https://avtocena.com" },
    }),
  );
  await page.goto(`${origin}/dealer-cabinet`);
  await page
    .getByRole("button", { name: "Фото покупателей", exact: true })
    .click();
  const png = await sharp({
    create: { width: 80, height: 60, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Загрузить фотографии")
    .setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: png });
  await page
    .locator('img[src^="/api/dealers/dealer_topavto/media/"]')
    .waitFor();
  const url = await page
    .locator('img[src^="/api/dealers/dealer_topavto/media/"]')
    .getAttribute("src");
  assert.equal((await context.request.get(origin + url)).status(), 200);
  await page
    .getByRole("button", { name: "Сохранить настройки дилера" })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Настройки сохранены" })
    .waitFor();
  const stored = JSON.parse(
    fs.readFileSync(
      path.join(dir, "dealers/showcases/dealer_topavto.json"),
      "utf8",
    ),
  );
  assert.equal(stored.buyerPhotos.length, 25);
  assert.equal(stored.version, 1);
  await page.screenshot({ path: path.join(out, "crm.png") });
  await page.getByRole('button',{name:'Автомобили',exact:true}).click();
  await page.getByRole('button',{name:'+ Добавить автомобиль',exact:true}).click();
  await page.getByLabel('Марка',{exact:true}).fill('Toyota');
  await page.getByLabel('Модель',{exact:true}).fill('Corolla');
  await page.getByRole('button',{name:'Сохранить черновик автомобиля',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Черновик сохранён'}).waitFor();
  const draftState=JSON.parse(fs.readFileSync(path.join(dir,'dealers/showcases/dealer_topavto.json'),'utf8'));
  assert.equal(draftState.offers.length,2);assert.equal(draftState.offers[1].status,'draft');assert.equal(draftState.offers[1].model,'Corolla');
  assert.equal(draftState.offers[0].status,'published');assert.equal(draftState.specialsEnabled,true);
  await page.reload();await page.getByRole('button',{name:'Автомобили',exact:true}).click();
  await page.getByRole('button',{name:'Toyota Corolla · Черновик',exact:true}).click();assert.equal(await page.getByLabel('Модель',{exact:true}).inputValue(),'Corolla');
  await page.screenshot({path:path.join(out,'new-car-persisted.png')});
  for(const [label,value] of [['Год выпуска','2024'],['Месяц производства (1–12)','6'],['Объём, см³','1500'],['Мощность ДВС / ЭВ, л.с.','100'],['Коробка передач','Автомат'],['Привод','Передний'],['Кузов','Седан'],['Цвет','Белый'],['Цена автомобиля, $','20000']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Загрузить фотографии').setInputFiles({name:'corolla.png',mimeType:'image/png',buffer:png});
  await page.locator('img[src^="/api/dealers/dealer_topavto/media/"]').first().waitFor();
  await page.getByRole('switch',{name:'Таможенные платежи включены в закупочную цену',exact:true}).check();
  await page.getByLabel('Статус',{exact:true}).selectOption('published');
  await page.getByRole('button',{name:'Сохранить настройки дилера',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Настройки сохранены'}).waitFor();
  const published=JSON.parse(fs.readFileSync(path.join(dir,'dealers/showcases/dealer_topavto.json'),'utf8'));
  assert.equal(published.offers[1].status,'published');assert.equal(published.offers[1].photos.length,1);
  await page.goto(`${origin}/cars/offer/special_dealer_topavto__${published.offers[1].id}?dealer=dealer_topavto`);
  await page.getByRole('heading',{name:'Toyota Corolla',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Выйти на АвтоЦену'}).getAttribute('href'),'/cars');
  await page.screenshot({path:path.join(out,'new-car-published.png')});
  await context.close();
  console.log(
    JSON.stringify({
      publicProfiles: [390, 1440],
      readonlyOffers: true,
      leadDialog: true,
      financeHidden: true,
      dealerUpload: true,
      persistedGallery: 25,
    }),
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  fs.closeSync(log);
  fs.rmSync(dir, { recursive: true, force: true });
}
