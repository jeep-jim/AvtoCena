import {estimateDealerDelivery} from './delivery-estimate';
import {normalizeDealerServicePricing,type DealerServicePricing} from "./service-pricing";
import {DEALER_MARKETS,dealerMarkets,type DealerMarket} from './catalog-markets';
import {validProfilePart} from './profile-url';
import {
  utilizationCoefficient2026,
  utilizationPowerKwForInput,
} from "../../../../packages/engine/src/calculation/russiaCustoms";
export const PILOT_DEALER_ID = "dealer_topavto";
export type DealerPhoto = { id: string; url: string; caption: string };
export type DealerOffice = {
  id: string;
  city: string;
  address: string;
  phone: string;
  hours: string;
  lat: number | null;
  lon: number | null;
  photos: DealerPhoto[];
};
export type DeliveryTariff = {
  id: string;
  city: string;
  usd: number;
  daysFrom: number;
  daysTo: number;
};
export type SpecialOffer = {
  availability?: "order" | "stock";
  condition?: "new" | "used";
  priceRub?: number;
  officeId?: string;
  sourceUrl?: string;
  id: string;
  status: "draft" | "published" | "sold";
  make: string;
  model: string;
  trim: string;
  year: number;
  productionMonth: number;
  engineCc: number;
  powerHp: number;
  power30MinKw: number;
  fuel: "petrol" | "diesel" | "electric" | "hybrid" | "series_hybrid";
  transmission: string;
  drive: string;
  body: string;
  color: string;
  steering: "left" | "right";
  mileageKm: number;
  description: string;
  equipment: string;
  photos: DealerPhoto[];
  priceUsd: number;
  customsIncluded: boolean;
  customsExtraRub: number;
  personalUseEligible: boolean;
  defaultCity: string;
  updatedAt: string;
};
export type DealerShowcase = {
  version: number;
  dealerId: string;
  citySlug?: string;
  slug?: string;
  profileEnabled: boolean;
  catalogMarkets: DealerMarket[];
  servicePricing?: DealerServicePricing;
  buyersEnabled: boolean;
  specialsEnabled: boolean;
  stockEnabled?: boolean;
  stockHeading?: string;
  name: string;
  description: string;
  headerIcon?: string;
  logoLight: string;
  logoDark: string;
  banner: string;
  phone: string;
  telegram: string;
  max: string;
  offices: DealerOffice[];
  buyerPhotos: DealerPhoto[];
  specialHeading: string;
  pricing: {
    originCity?: string;
    distancePricing?: boolean;
    baseCity?: string;
    rateMode?: "auto" | "manual";
    usdRub: number;
    rateAt: string;
    rateSource: string;
    fxMarkupRub: number;
    deliveryMarkupRub: number;
    commissionRub: number;
    documentsRub: number;
    tariffs: DeliveryTariff[];
  };
  offers: SpecialOffer[];
  updatedAt: string;
};
export function defaultShowcase(id: string, name = ""): DealerShowcase {
  return {
    version: 0,
    dealerId: id,
    citySlug: id === PILOT_DEALER_ID ? "nvkz" : "",
    slug: id === PILOT_DEALER_ID ? "topavto" : "",
    profileEnabled: false,
    servicePricing: {},
    catalogMarkets: id === PILOT_DEALER_ID ? DEALER_MARKETS.map(m=>m.id) : [],
    buyersEnabled: id === PILOT_DEALER_ID,
    specialsEnabled: false,
    stockEnabled: false,
    stockHeading: "Автомобили в наличии",
    name: name || (id === PILOT_DEALER_ID ? "TOP AVTO" : ""),
    description: "",
    logoLight: id === PILOT_DEALER_ID ? "/brands/topavto-logo.png" : "",
    logoDark: id === PILOT_DEALER_ID ? "/brands/topavto-logo.png" : "",
    banner: "",
    phone: "",
    telegram: "",
    max: "",
    offices: [],
    buyerPhotos:
      id === PILOT_DEALER_ID
        ? Array.from({ length: 24 }, (_, i) => ({
            id: `original-${i + 1}`,
            url: `/buyers/${i + 1}.jpg`,
            caption: "",
          }))
        : [],
    specialHeading: "✅ СПЕЦ ПРЕДЛОЖЕНИЕ от 5 дней и авто у вас дома!",
    pricing: {
      originCity:"Бишкек",
      distancePricing:id===PILOT_DEALER_ID,
      baseCity:id===PILOT_DEALER_ID?"Новосибирск":"",
      rateMode: "auto",
      usdRub: 0,
      rateAt: "",
      rateSource: "https://www.profinance.ru/chart/usdrub/",
      fxMarkupRub: 2.5,
      deliveryMarkupRub: 60000,
      commissionRub: 140000,
      documentsRub: 45000,
      tariffs: id===PILOT_DEALER_ID?[{id:'novosibirsk',city:'Новосибирск',usd:900,daysFrom:5,daysTo:10},{id:'moscow',city:'Москва',usd:1100,daysFrom:5,daysTo:10}]:[],
    },
    offers: [],
    updatedAt: "",
  };
}
export function specialTitle(o: SpecialOffer) {
  return [o.make, o.model, o.trim].filter(Boolean).join(" ");
}
export function specialOfferId(dealerId: string, id: string) {
  return `special_${dealerId}__${id}`;
}
export function parseSpecialId(value: string) {
  const m = /^special_([a-zA-Z0-9_-]{1,80})__([a-zA-Z0-9-]{1,80})$/.exec(value);
  return m ? { dealerId: m[1], id: m[2] } : null;
}
export function specialPath(dealerId: string, id: string) {
  return `/cars/offer/${specialOfferId(dealerId, id)}`;
}
export type OfferAvailability = "order" | "stock";
export const offerAvailability = (o: SpecialOffer): OfferAvailability => o.availability === "stock" ? "stock" : "order";
export const offerAvailabilityLabel = (o: SpecialOffer) => offerAvailability(o) === "stock" ? "В наличии" : "Под заказ";
export const offerSectionEnabled = (s: DealerShowcase, o: SpecialOffer) => offerAvailability(o) === "stock" ? s.stockEnabled === true : s.specialsEnabled;
export const offerSectionHeading = (s: DealerShowcase, kind: OfferAvailability) => kind === "stock" ? s.stockHeading || "Автомобили в наличии" : s.specialHeading;
export function calculateSpecial(
  s: DealerShowcase,
  o: SpecialOffer,
  city = (s.pricing.distancePricing?o.defaultCity:"") || s.pricing.baseCity || (s.dealerId===PILOT_DEALER_ID?"Новосибирск":o.defaultCity),
  now = new Date(),
) {
  if (offerAvailability(o) === "stock") {
    const office=s.offices.find(item=>item.id===o.officeId);
    const errors:string[]=[];
    if(!Number.isInteger(o.year)||o.year<1900||o.year>now.getFullYear())errors.push("Проверьте год выпуска");
    if (!(Number.isFinite(o.priceRub) && (o.priceRub || 0)>0)) errors.push("Укажите цену автомобиля в рублях");
    if (!office?.city || !office.address) errors.push("Выберите адрес, где находится автомобиль");
    return {complete:errors.length===0,errors,rate:0,city:office?.city||"",daysFrom:undefined as number|undefined,daysTo:undefined as number|undefined,
      lines:[{id:"vehicle",title:"Цена автомобиля",amountRub:o.priceRub||0}],totalRub:errors.length?null:o.priceRub!};
  }
  const p = s.pricing,
    tariff = estimateDealerDelivery(p.originCity||'Бишкек',city,p.tariffs,p.distancePricing);
  const errors: string[] = [];
  if (!(p.usdRub > 0)) errors.push("Укажите курс USD/RUB");
  const rateTime = Date.parse(p.rateAt);
  if (
    !Number.isFinite(rateTime) ||
    now.getTime() - rateTime > 7 * 86400000 ||
    rateTime > now.getTime() + 300000
  )
    errors.push("Подтвердите актуальный курс (не старше 7 дней)");
  if (!tariff) errors.push("Добавьте тариф доставки для выбранного города");
  if (tariff && !(tariff.usd > 0 || (tariff.estimated && tariff.usd === 0))) errors.push("Укажите стоимость доставки в долларах");
  if (!(o.priceUsd > 0)) errors.push("Укажите цену автомобиля в долларах");
  if (!o.customsIncluded && !(o.customsExtraRub > 0))
    errors.push(
      "Укажите таможенные платежи или подтвердите, что они включены в цену автомобиля",
    );
  const powertrainKind =
    o.fuel === "electric"
      ? "electric"
      : o.fuel === "series_hybrid"
        ? "series_hybrid"
        : o.fuel === "hybrid"
          ? "other_hybrid"
          : "combustion";
  const power = utilizationPowerKwForInput(
    {
      customsValueRub: 0,
      eurRateRub: 0,
      powerHp: o.powerHp,
      icePowerKw: o.powerHp * 0.73549875,
      power30MinKw: o.power30MinKw,
    },
    powertrainKind,
  );
  const production = new Date(Date.UTC(o.year, o.productionMonth - 1, 1));
  const used = now.getTime() >= Date.UTC(o.year + 3, o.productionMonth - 1, 1);
  if (
    !Number.isInteger(o.year) ||
    o.year < 1900 ||
    !Number.isInteger(o.productionMonth) ||
    o.productionMonth < 1 ||
    o.productionMonth > 12 ||
    production > now
  )
    errors.push("Проверьте год и месяц производства");
  if (!power) errors.push("Укажите мощность для расчёта утильсбора");
  const coefficient = power
    ? utilizationCoefficient2026({
        powertrainKind,
        utilizationPowerKw: power,
        engineCc: o.engineCc,
        ageBand: used ? "from_3_to_5_years" : "up_to_3_years",
        personalUseEligible: o.personalUseEligible,
      })
    : undefined;
  if (coefficient === undefined)
    errors.push("Недостаточно данных для утильсбора");
  const rate = p.usdRub + p.fxMarkupRub;
  const lines = [
    {
      id: "vehicle",
      title: "Цена автомобиля",
      amountRub: Math.round(o.priceUsd * rate),
    },
    {
      id: "delivery",
      title: `Доставка в ${tariff?.city || city || "выбранный город"}`,
      amountRub: Math.round((tariff?.usd || 0) * rate + p.deliveryMarkupRub),
    },
    ...(!o.customsIncluded
      ? [
          {
            id: "customs",
            title: "Таможенные платежи",
            amountRub: o.customsExtraRub,
          },
        ]
      : []),
    { id: "commission", title: "Комиссия дилера", amountRub: p.commissionRub },
    { id: "documents", title: "СБКТС и ЭПТС", amountRub: p.documentsRub },
    {
      id: "utilization",
      title: "Утилизационный сбор",
      amountRub: Math.round(20000 * (coefficient || 0)),
    },
  ];
  return {
    complete: errors.length === 0,
    errors,
    rate,
    city: tariff?.city || city,
    daysFrom: tariff?.daysFrom,
    daysTo: tariff?.daysTo,
    lines,
    totalRub: errors.length
      ? null
      : lines.reduce((sum, l) => sum + l.amountRub, 0),
  };
}
const text = (v: unknown, n = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
const number = (v: unknown, min = 0, max = 1e9) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error("Проверьте числовые поля");
  return n;
};
export function mediaUrl(v: unknown, dealerId: string) {
  const u = text(v, 1000);
  if (!u) return "";
  if (/^\/buyers\/\d+\.jpg$/.test(u) && dealerId === PILOT_DEALER_ID) return u;
  if (dealerId === PILOT_DEALER_ID && ["/brands/topavto-logo.png", "/dealers/topavto-banner-1800x600.webp", "/dealers/topavto-banner-v2.webp", "/dealers/topavto-banner-v3.webp"].includes(u))
    return u;
  if (new RegExp(`^/api/dealers/${dealerId}/media/[a-f0-9-]{36}$`).test(u))
    return u;
  throw Error("Сначала загрузите изображение");
}
function listingUrl(value: unknown) {
  const raw=text(value,2048);if(!raw)return '';
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password)throw Error('Укажите HTTPS-ссылку на объявление');
  return url.href;
}
function photos(v: unknown, id: string, max = 40): DealerPhoto[] {
  if (!Array.isArray(v)) return [];
  if (v.length > max) throw Error(`Можно загрузить не более ${max} фотографий`);
  return v
    .map((p) => ({
      id: text(p.id, 80),
      url: mediaUrl(p.url, id),
      caption: text(p.caption, 200),
    }))
    .filter((p) => p.url);
}
export function contactUrl(v: unknown, kind: "telegram" | "max") {
  const raw = text(v, 300);
  if (!raw) return "";
  const u = new URL(
    raw.startsWith("@") && kind === "telegram"
      ? `https://t.me/${raw.slice(1)}`
      : raw,
  );
  const hosts = kind === "telegram" ? ["t.me"] : ["max.ru", "max.app"];
  if (
    u.protocol !== "https:" ||
    !hosts.includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("Разрешены только ссылки Telegram и MAX");
  return u.href;
}
export function normalizeShowcase(
  raw: any,
  id: string,
  version: number,
): DealerShowcase {
  const base = defaultShowcase(id),
    p = raw.pricing || {};
  const s: DealerShowcase = {
    ...base,
    version,
    dealerId: id,
    citySlug: text(raw.citySlug,40).toLowerCase(),
    slug: text(raw.slug,40).toLowerCase(),
    profileEnabled: raw.profileEnabled === true,
    servicePricing: normalizeDealerServicePricing(raw.servicePricing),
    catalogMarkets: raw.catalogMarkets === undefined ? base.catalogMarkets : dealerMarkets(raw.catalogMarkets),
    buyersEnabled: raw.buyersEnabled === true,
    specialsEnabled: raw.specialsEnabled === true,
    stockEnabled: raw.stockEnabled === true,
    stockHeading: text(raw.stockHeading,180) || "Автомобили в наличии",
    name: text(raw.name, 120),
    description: text(raw.description, 5000),
    headerIcon: mediaUrl(raw.headerIcon,id),
    logoLight: mediaUrl(raw.logoLight, id),
    logoDark: mediaUrl(raw.logoDark, id),
    banner: mediaUrl(raw.banner, id),
    phone: text(raw.phone, 60),
    telegram: contactUrl(raw.telegram, "telegram"),
    max: contactUrl(raw.max, "max"),
    specialHeading: text(raw.specialHeading, 180) || base.specialHeading,
    buyerPhotos: photos(raw.buyerPhotos, id, 100),
    offices: [],
    offers: [],
    pricing: {
      originCity:text(p.originCity,120)||"Бишкек",
      distancePricing:p.distancePricing===true,
      baseCity:text(p.baseCity,120)|| (id===PILOT_DEALER_ID?"Новосибирск":""),
      rateMode: p.rateMode === "manual" ? "manual" : "auto",
      usdRub: number(p.usdRub, 0, 1000),
      rateAt: text(p.rateAt, 50),
      rateSource: base.pricing.rateSource,
      fxMarkupRub: number(p.fxMarkupRub, 0, 100),
      deliveryMarkupRub: number(p.deliveryMarkupRub, 0, 1e7),
      commissionRub: number(p.commissionRub, 0, 1e7),
      documentsRub: number(p.documentsRub, 0, 1e7),
      tariffs: [],
    },
    updatedAt: new Date().toISOString(),
  };
  if (!s.name) throw Error("Укажите название дилера");
  if ((s.citySlug || s.slug) && (!validProfilePart(s.citySlug || "") || !validProfilePart(s.slug || ""))) throw Error("Для ссылки укажите код города и никнейм: 2–40 латинских букв, цифр или дефисов, начиная с буквы");
  if (!Array.isArray(raw.offices) || raw.offices.length > 100)
    throw Error("Проверьте список офисов");
  s.offices = raw.offices.map((o: any) => ({
    id: text(o.id, 80),
    city: text(o.city, 120),
    address: text(o.address, 400),
    phone: text(o.phone, 60),
    hours: text(o.hours, 200),
    lat: o.lat === null || o.lat === "" ? null : number(o.lat, -90, 90),
    lon: o.lon === null || o.lon === "" ? null : number(o.lon, -180, 180),
    photos: photos(o.photos, id, 20),
  }));
  if (s.offices.some((o) => !o.city || !o.address))
    throw Error("Укажите город и адрес каждого офиса");
  if (!Array.isArray(p.tariffs) || p.tariffs.length > 500)
    throw Error("Проверьте тарифы доставки");
  s.pricing.tariffs = p.tariffs.map((t: any) => ({
    id: text(t.id, 80),
    city: text(t.city, 120),
    usd: number(t.usd, 0, 1e6),
    daysFrom: number(t.daysFrom, 1, 365),
    daysTo: number(t.daysTo, 1, 365),
  }));
  if (
    s.pricing.tariffs.some((t) => !t.city || t.daysFrom > t.daysTo) ||
    new Set(s.pricing.tariffs.map((t) => t.city.toLowerCase())).size !==
      s.pricing.tariffs.length
  )
    throw Error("Проверьте города и сроки доставки");
  if (!Array.isArray(raw.offers) || raw.offers.length > 200)
    throw Error("В витрине можно сохранить до 200 автомобилей");
  s.offers = raw.offers.map((o: any) => {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(o.id))
      throw Error("Неверный идентификатор автомобиля");
    return {
      id: o.id,
      availability: o.availability === "stock" ? "stock" : "order",
      condition: o.availability === "stock" && o.condition === "used" ? "used" : "new",
      priceRub: number(o.priceRub ?? 0,0,1e9),
      officeId: text(o.officeId,80),
      sourceUrl: listingUrl(o.sourceUrl),
      status: ["published", "sold"].includes(o.status) ? o.status : "draft",
      make: text(o.make, 80),
      model: text(o.model, 100),
      trim: text(o.trim, 200),
      year: number(o.year, 0, 2100),
      productionMonth: number(o.productionMonth, 0, 12),
      engineCc: number(o.engineCc, 0, 20000),
      powerHp: number(o.powerHp, 0, 3000),
      power30MinKw: number(o.power30MinKw, 0, 3000),
      fuel: [
        "petrol",
        "diesel",
        "electric",
        "hybrid",
        "series_hybrid",
      ].includes(o.fuel)
        ? o.fuel
        : "petrol",
      transmission: text(o.transmission, 60),
      drive: text(o.drive, 60),
      body: text(o.body, 60),
      color: text(o.color, 100),
      steering: o.steering === "right" ? "right" : "left",
      mileageKm: number(o.mileageKm, 0, 1e7),
      description: text(o.description, 8000),
      equipment: text(o.equipment, 8000),
      photos: photos(o.photos, id, 40),
      priceUsd: number(o.priceUsd, 0, 1e7),
      customsIncluded: o.customsIncluded === true,
      customsExtraRub: number(o.customsExtraRub, 0, 1e8),
      personalUseEligible: o.personalUseEligible === true,
      defaultCity: text(o.defaultCity, 120),
      updatedAt: new Date().toISOString(),
    };
  });
  if (new Set(s.offers.map((o) => o.id)).size !== s.offers.length)
    throw Error("Автомобили не должны повторяться");
  for (const o of s.offers.filter((o) => o.status === "published")) {
    const missing=specialPublicationFields(o);
    if(missing.length)throw Error(`Заполните характеристики и фото: ${specialTitle(o)||"новый автомобиль"}. Не хватает: ${missing.join(", ")}`);
    const c = calculateSpecial(s, o);
    if (offerSectionEnabled(s,o) && !c.complete) throw Error(`${specialTitle(o)}: ${c.errors.join(". ")}`);
  }
  if (s.profileEnabled && (!s.phone || !s.offices.length))
    throw Error("Для публикации дилера нужны телефон и хотя бы один офис");
  return s;
}

/** Shared completeness checklist; pricing rules remain in calculateSpecial. */
export function specialPublicationFields(o:SpecialOffer):string[]{
 return [!o.make&&'марка',!o.model&&'модель',!o.photos.length&&'фотографии',!o.year&&'год выпуска',(offerAvailability(o)==='order'&&!o.productionMonth)&&'месяц производства',!o.transmission&&'коробка передач',!o.drive&&'привод',!o.body&&'кузов',!o.color&&'цвет',(!o.engineCc&&o.fuel!=='electric')&&'объём двигателя',!o.powerHp&&'мощность'].filter(Boolean) as string[];
}
