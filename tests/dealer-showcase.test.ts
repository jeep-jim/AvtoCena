import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultShowcase,
  normalizeShowcase,
  offerAvailability,
  calculateSpecial,
  specialOfferId,
  parseSpecialId,
  type SpecialOffer,
} from "../apps/web/lib/dealers/showcase-model";
import {
  saveShowcase,
  readShowcase,
  savePublicFeatures,
  readPublicFeatures,
} from "../apps/web/lib/dealers/showcase-store";
import {
  getSpecialOffer,
  publicRail,
  specialLeadSnapshot,
} from "../apps/web/lib/dealers/public-showcase";
import {
  resetJsonStorageForTests,
  readChunkedDataJson,
} from "../apps/web/lib/data";
import {
  isPublicIPv4,
  prepareDealerImage,
} from "../apps/web/lib/dealers/media";
import { createLead } from "../apps/web/lib/lead-intake";
import sharp from "sharp";
const offer: SpecialOffer = {
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
  description: "Новый автомобиль",
  equipment: "",
  photos: [{ id: "p", url: "/buyers/1.jpg", caption: "" }],
  priceUsd: 34000,
  customsIncluded: true,
  customsExtraRub: 0,
  personalUseEligible: true,
  defaultCity: "Новосибирск",
  updatedAt: "",
};
function fixture() {
  const s = defaultShowcase("dealer_topavto");
  s.pricing = {
    ...s.pricing,
    rateMode: "manual",
    usdRub: 80,
    rateAt: new Date().toISOString(),
    tariffs: [
      { id: "nsk", city: "Новосибирск", usd: 1000, daysFrom: 5, daysTo: 7 },
      { id: "msk", city: "Москва", usd: 2000, daysFrom: 8, daysTo: 10 },
    ],
  };
  s.offers = [structuredClone(offer)];
  return s;
}
test("legacy gallery and affiliate default remain enabled, new features off", async () => {
  const s = defaultShowcase("dealer_topavto");
  assert.equal(s.buyerPhotos.length, 24);
  assert.equal(s.buyersEnabled, true);
  assert.equal(s.profileEnabled, false);
  assert.equal(s.specialsEnabled, false);
  assert.equal(defaultShowcase("dealer_other").buyerPhotos.length, 0);
  assert.equal(defaultShowcase("dealer_other").buyersEnabled, false);
});
test("special price applies forex markup once and reuses recycling rules", () => {
  const s = fixture(),
    c = calculateSpecial(s, offer);
  assert.equal(c.rate, 82.5);
  assert.equal(c.totalRub, 3135900);
  assert.equal(c.lines.find((l) => l.id === "delivery")?.amountRub, 142500);
  assert.equal(c.lines.find((l) => l.id === "utilization")?.amountRub, 3400);
  assert.equal(calculateSpecial(s, offer, "Москва").totalRub, 3218400);
  assert.equal(calculateSpecial(s, offer, "Омск").totalRub, null);
  assert.equal(
    calculateSpecial(s, {
      ...offer,
      customsIncluded: false,
      customsExtraRub: 100000,
    }).totalRub,
    3235900,
  );
  assert.equal(
    calculateSpecial(s, { ...offer, customsIncluded: false }).totalRub,
    null,
  );
  assert.equal(
    calculateSpecial(s, { ...offer, fuel: "hybrid" }).totalRub,
    null,
  );
  assert.equal(
    calculateSpecial(s, { ...offer, productionMonth: 1.5 }).totalRub,
    null,
  );
  assert.equal(
    calculateSpecial(
      { ...s, pricing: { ...s.pricing, rateAt: "2020-01-01" } },
      offer,
    ).totalRub,
    null,
  );
});
test("publish validation, social allowlist and isolated dealer image references", () => {
  const s = fixture();
  assert.equal(normalizeShowcase(s, s.dealerId, 1).version, 1);
  assert.throws(() =>
    normalizeShowcase(
      { ...s, telegram: "https://instagram.com/test" },
      s.dealerId,
      1,
    ),
  );
  assert.throws(() =>
    normalizeShowcase(
      {
        ...s,
        buyerPhotos: [{ id: "x", url: "https://example.com/image.jpg" }],
      },
      s.dealerId,
      1,
    ),
  );
  assert.throws(() =>
    normalizeShowcase(
      { ...s, offers: [{ ...offer, photos: [] }] },
      s.dealerId,
      1,
    ),
  );
  const emptyEnabled=normalizeShowcase({...s,specialsEnabled:true,offers:[]},s.dealerId,1);
  assert.equal(emptyEnabled.specialsEnabled,true);assert.deepEqual(publicRail(emptyEnabled),[]);
  assert.throws(() =>
    normalizeShowcase({ ...s, profileEnabled: true }, s.dealerId, 1),
  );
  assert.equal(
    normalizeShowcase(
      { ...s, offers: [{ ...offer, status: "draft", priceUsd: 0 }] },
      s.dealerId,
      1,
    ).offers[0].status,
    "draft",
  );
  assert.deepEqual(parseSpecialId(specialOfferId("dealer_topavto", offer.id)), {
    dealerId: "dealer_topavto",
    id: offer.id,
  });
});
test("remote media rejects internal addresses; images are decoded and normalized", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.17.0.1",
    "100.100.100.200",
    "::1",
  ])
    assert.equal(isPublicIPv4(ip), false);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
  await assert.rejects(() => prepareDealerImage(Buffer.from("<svg/>")));
  const png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  assert.equal(
    (await sharp(await prepareDealerImage(png)).metadata()).format,
    "webp",
  );
});
test("owner configuration versions, unpublished isolation and base-city price independent of visitor city", async () => {
  const cwd = process.cwd(),
    driver = process.env.JSON_STORAGE_DRIVER;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dealer-showcase-"));
  fs.mkdirSync(path.join(tmp, "data"));
  process.chdir(tmp);
  process.env.JSON_STORAGE_DRIVER = "local";
  resetJsonStorageForTests();
  try {
    const s = fixture();
    const saved = await saveShowcase(s.dealerId, s);
    assert.equal(saved.version, 1);
    await assert.rejects(() => saveShowcase(s.dealerId, s), /изменились/);
    const id = specialOfferId(s.dealerId, offer.id);
    assert.equal(await getSpecialOffer(id), null);
    assert.ok(await getSpecialOffer(id, true));
    const published = await saveShowcase(s.dealerId, {
      ...saved,
      specialsEnabled: true,
    });
    assert.ok(await getSpecialOffer(id));
    assert.equal((await readShowcase(s.dealerId))?.version, 2);
    assert.equal((await specialLeadSnapshot(id, "Москва"))?.totalRub, 3135900);
    assert.equal((await readPublicFeatures()).affiliatesEnabled, true);
    await savePublicFeatures({ version: 0, affiliatesEnabled: false });
    assert.equal((await readPublicFeatures()).affiliatesEnabled, false);
    await assert.rejects(() =>
      savePublicFeatures({ version: 0, affiliatesEnabled: true }),
    );
    const r = await createLead(
      new Request("https://avtocena.com/api/leads", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://avtocena.com",
        },
        body: JSON.stringify({
          requestMode: "offer",
          source: "catalog_offer_request",
          offerId: id,
          operationId: "special-city-test",
          submissionThreadToken: "12345678-1234-4321-aaaa-123456789abc",
          phone: "+79999999999",
          name: "Тест",
          city: "Москва",
          contactPreference: "call",
          personalDataConsent: true,
          personalDataConsentVersion: "lead-consent-2026-10-02",
          totalRub: 1,
        }),
      }),
    );
    assert.equal(r.status, 200);
    const leads = await readChunkedDataJson<any>("leads/leads.json", []);
    assert.equal(leads[0].totalRub, 3135900);
    assert.equal(leads[0].offerSnapshot.dealerId, s.dealerId);
    assert.equal(leads[0].deliveryQuote.origin, "Бишкек");
    assert.equal(leads[0].deliveryQuote.amountRub, 142500);
    assert.equal(leads[0].selectedOffers[0].deliveryQuote.amountRub, 142500);
    const followup = await createLead(new Request("https://avtocena.com/api/leads", {
      method:"POST",headers:{"content-type":"application/json",origin:"https://avtocena.com"},
      body:JSON.stringify({requestMode:"offer",source:"catalog_offer_request",offerId:id,operationId:"special-city-followup",submissionThreadToken:"12345678-1234-4321-aaaa-123456789abc",phone:"+79999999999",name:"Тест",city:"Новосибирск",contactPreference:"call",personalDataConsent:true,personalDataConsentVersion:"lead-consent-2026-10-02",totalRub:1})
    }));
    assert.equal(followup.status,200);
    const updated=await readChunkedDataJson<any>("leads/leads.json",[]);
    assert.equal(updated.length,1);
    assert.equal(updated[0].totalRub,3135900);
    assert.equal(updated[0].offerSnapshot.totalRub,3135900);
    assert.equal(updated[0].selectedOffers[0].totalRub,3135900);
    assert.equal(updated[0].deliveryQuote.amountRub,142500);
    assert.equal(published.specialsEnabled, true);
    const stock:SpecialOffer={...offer,id:"stock-public",availability:"stock",condition:"used",year:2021,productionMonth:0,priceRub:1250000,priceUsd:0,officeId:"yard"};
    const withStock=await saveShowcase(s.dealerId,{...published,stockEnabled:true,offices:[{id:"yard",city:"Новокузнецк",address:"Улица, 10",phone:"",hours:"",lat:null,lon:null,photos:[]}],offers:[...published.offers,stock]});
    const stockId=specialOfferId(s.dealerId,stock.id);
    const stockSnapshot=await specialLeadSnapshot(stockId,"Москва");assert.equal(stockSnapshot?.totalRub,1250000);assert.equal(stockSnapshot?.sourceCurrency,"RUB");assert.equal(stockSnapshot?.deliveryQuote,undefined);
    const sold=await saveShowcase(s.dealerId,{...withStock,offers:withStock.offers.map(o=>o.id===stock.id?{...o,status:"sold"}:o)});
    assert.equal(sold.stockEnabled,true);assert.equal(await getSpecialOffer(stockId),null);assert.ok(await getSpecialOffer(stockId,true));

  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("expired exchange rate cannot prevent hiding the special rail", () => {
  const s=fixture(); s.pricing.rateAt="2020-01-01";
  assert.throws(()=>normalizeShowcase({...s,specialsEnabled:true},s.dealerId,1),/курс/);
  const hidden=normalizeShowcase({...s,specialsEnabled:false},s.dealerId,1);
  assert.equal(hidden.specialsEnabled,false);
  assert.equal(calculateSpecial(hidden,hidden.offers[0]).totalRub,null);
});

test("an unfilled delivery tariff never becomes a published zero-cost route", () => {
  const s=fixture(); s.pricing.tariffs[0].usd=0;
  assert.equal(calculateSpecial(s,s.offers[0]).totalRub,null);
  assert.throws(()=>normalizeShowcase({...s,specialsEnabled:true},s.dealerId,1),/стоимость доставки/);
});


test("stock vehicles use an exact ruble price and dealer address, without import fees",()=>{
 const s=fixture();s.pricing.rateAt="2020-01-01";s.pricing.tariffs=[];
 s.offices=[{id:"stock-yard",city:"Новокузнецк",address:"Улица, 10",phone:"",hours:"",lat:null,lon:null,photos:[]}];
 const stock:SpecialOffer={...offer,id:"used-fit",availability:"stock",condition:"used",year:2021,productionMonth:0,priceUsd:0,priceRub:1250000,officeId:"stock-yard",customsIncluded:false,customsExtraRub:0,mileageKm:42000};
 s.offers=[stock];s.stockEnabled=true;s.specialsEnabled=false;
 const c=calculateSpecial(s,stock,"Москва");assert.equal(c.complete,true);assert.equal(c.totalRub,1250000);assert.equal(c.city,"Новокузнецк");assert.equal(c.daysFrom,undefined);assert.equal(c.lines.length,1);assert.equal(c.rate,0);
 const normalized=normalizeShowcase(s,s.dealerId,1);assert.equal(normalized.offers[0].condition,"used");assert.equal(normalized.offers[0].productionMonth,0);assert.equal(normalized.offers[0].priceRub,1250000);
 assert.equal(publicRail(normalized)[0].availability,"stock");assert.equal(publicRail(normalized)[0].address,"Улица, 10");assert.equal(publicRail({...normalized,stockEnabled:false}).length,0);
 assert.equal(calculateSpecial(s,{...stock,officeId:"unknown"}).complete,false);assert.equal(calculateSpecial(s,{...stock,priceRub:0}).totalRub,null);
 assert.throws(()=>normalizeShowcase({...s,offers:[{...stock,priceRub:-1}]},s.dealerId,1));
 assert.equal(offerAvailability(offer),"order");assert.equal(calculateSpecial(fixture(),offer).totalRub,3135900);
});
test("stock and order rails have independent visibility and pricing",()=>{
 const s=fixture();s.specialsEnabled=true;s.stockEnabled=true;s.stockHeading="Авто на нашей площадке";
 s.offices=[{id:"yard",city:"Кемерово",address:"Улица, 1",phone:"",hours:"",lat:null,lon:null,photos:[]}];
 s.offers.push({...offer,id:"stock",availability:"stock",condition:"new",priceRub:2000000,officeId:"yard"});
 let rows=publicRail(s);assert.equal(rows.length,2);assert.equal(rows[0].availability,"order");assert.equal(rows[1].price,2000000);assert.equal(rows[1].heading,s.stockHeading);
 rows=publicRail({...s,specialsEnabled:false});assert.equal(rows.length,1);assert.equal(rows[0].id,"stock");
 rows=publicRail({...s,stockEnabled:false});assert.equal(rows.length,1);assert.equal(rows[0].id,offer.id);
});
