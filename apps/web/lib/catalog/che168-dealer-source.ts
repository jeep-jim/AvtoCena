import { cacheImageFromUrl, stableOfferId } from "./storage";
import { isAllowedCatalogSourceUrl } from "./required-catalog-sources";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type DealerRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  mileageKm?: number;
  engineCc?: number;
  powerHp?: number;
  powerKw?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  price?: number;
  images: string[];
  city?: string;
};

const HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
};

const DEALERS = [
  "617832", "429115", "610278", "127018", "510139", "515780", "602177", "640574", "601372", "551072", "97866", "514850",
];

const BAD_IMAGE = /(?:qrcode|qr-code|qr_|weixin|wechat|scan|download|app|logo|icon|avatar|profile|placeholder|default|banner|sprite|tracking|pixel|captcha)/i;

const BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/梅赛德斯|奔驰/g, "Mercedes-Benz"], [/宝马/g, "BMW"], [/奥迪/g, "Audi"], [/雷克萨斯/g, "Lexus"], [/丰田/g, "Toyota"],
  [/本田/g, "Honda"], [/日产/g, "Nissan"], [/马自达/g, "Mazda"], [/三菱/g, "Mitsubishi"], [/斯巴鲁/g, "Subaru"],
  [/铃木/g, "Suzuki"], [/现代/g, "Hyundai"], [/起亚/g, "Kia"], [/捷尼赛思/g, "Genesis"], [/大众/g, "Volkswagen"],
  [/沃尔沃/g, "Volvo"], [/保时捷/g, "Porsche"], [/路虎/g, "Land Rover"], [/捷豹/g, "Jaguar"], [/福特/g, "Ford"],
  [/雪佛兰/g, "Chevrolet"], [/凯迪拉克/g, "Cadillac"], [/别克/g, "Buick"], [/标致/g, "Peugeot"], [/雪铁龙/g, "Citroen"],
  [/雷诺/g, "Renault"], [/特斯拉/g, "Tesla"], [/比亚迪/g, "BYD"], [/吉利/g, "Geely"], [/长安/g, "Changan"],
  [/奇瑞/g, "Chery"], [/哈弗/g, "Haval"], [/广汽/g, "GAC"], [/传祺/g, "GAC"], [/理想/g, "Li Auto"],
  [/蔚来/g, "Nio"], [/小鹏/g, "XPeng"], [/极氪/g, "Zeekr"], [/领克/g, "Lynk & Co"], [/红旗/g, "Hongqi"],
  [/阿斯顿.?马丁/g, "Aston Martin"], [/劳斯莱斯/g, "Rolls-Royce"], [/宾利/g, "Bentley"], [/兰博基尼/g, "Lamborghini"],
  [/法拉利/g, "Ferrari"], [/玛莎拉蒂/g, "Maserati"], [/Jeep|吉普/gi, "Jeep"], [/MINI/gi, "MINI"],
];

const MODEL_MAKE_PATTERNS: Array<[RegExp, string]> = [
  [/埃尔法|威尔法|汉兰达|凯美瑞|卡罗拉|雷凌|皇冠陆放|普拉多|兰德酷路泽|赛那/g, "Toyota"],
  [/Model\s*[3SXY]|Cybertruck/gi, "Tesla"], [/迈腾|速腾|途观|途昂|途岳|高尔夫|Polo|帕萨特/gi, "Volkswagen"],
  [/Macan|Cayenne|Panamera|Taycan|Boxster|Carrera/gi, "Porsche"], [/Urus|Huracan|Revuelto/gi, "Lamborghini"],
  [/库里南|古思特|幻影|魅影|曜影/g, "Rolls-Royce"], [/揽胜|卫士|发现神行/g, "Land Rover"],
];

function clean(value: unknown) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value.replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}

function numeric(value: unknown) {
  const number = Number(String(value || "").replace(/,/g, "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function decode(bytes: ArrayBuffer, contentType: string) {
  const declared = contentType.match(/charset=([^;\s]+)/i)?.[1]?.replace(/["']/g, "");
  for (const encoding of [declared, "utf-8", "gb18030"].filter(Boolean) as string[]) {
    try {
      const value = new TextDecoder(encoding).decode(bytes);
      if ((value.match(/�/g) || []).length < Math.max(2, value.length * 0.0005)) return value;
    } catch { /* try next charset */ }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

async function fetchMarkup(url: string, referer?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    if (!isAllowedCatalogSourceUrl("china", "autohome_used_china_open", url)) throw new Error("che168_non_domestic_url");
    const response = await fetch(url, { headers: { ...HEADERS, referer: referer || "https://www.che168.com/" }, redirect: "error", signal: controller.signal });
    const bytes = await response.arrayBuffer();
    return { response, markup: decode(bytes, response.headers.get("content-type") || "") };
  } finally { clearTimeout(timer); }
}

function deriveMakeModel(rawTitle: string) {
  const title = clean(rawTitle).replace(/^\s*(?:19|20)\d{2}\s*/, "").replace(/二手车|准新车|在售|报价|图片/g, " ").trim();
  let make = "";
  for (const [pattern, normalized] of BRAND_PATTERNS) if (pattern.test(title)) { make = normalized; pattern.lastIndex = 0; break; }
  if (!make) for (const [pattern, normalized] of MODEL_MAKE_PATTERNS) if (pattern.test(title)) { make = normalized; pattern.lastIndex = 0; break; }
  const model = title
    .replace(/^(?:Mercedes-Benz|BMW|Audi|Lexus|Toyota|Honda|Nissan|Mazda|Mitsubishi|Subaru|Suzuki|Hyundai|Kia|Volkswagen|Volvo|Porsche|Land Rover|Ford|Chevrolet|Cadillac|Buick|Peugeot|Citroen|Renault|Tesla|BYD|Geely|Changan|Chery|Haval|GAC|Li Auto|Nio|XPeng|Zeekr|Hongqi)\s*/i, "")
    .replace(/\b(?:19|20)\d{2}款\b/g, " ").replace(/\s+/g, " ").trim().split(/\s+/).slice(0, 10).join(" ");
  return { title, make, model: model || make };
}

function priceCny(value: string) {
  const match = value.match(/(?:￥|¥)?\s*([0-9]+(?:[.,][0-9]+)?)\s*万(?:元)?(?!公里)/i);
  if (!match) return undefined;
  const number = Number(match[1].replace(",", "."));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10_000) : undefined;
}

function mileage(value: string) {
  const match = value.match(/([0-9]+(?:[.,][0-9]+)?)\s*万公里/i);
  if (match) return Math.round(Number(match[1].replace(",", ".")) * 10_000);
  const km = value.match(/([0-9][0-9, ]+)\s*公里/i);
  return km ? Math.round(numeric(km[1]) || 0) || undefined : undefined;
}

function specValues(value: string) {
  const liters = numeric(value.match(/([0-9]+(?:[.,][0-9]+)?)\s*[LT]\b/i)?.[1]);
  const engineCc = numeric(value.match(/([0-9][0-9, ]{2,5})\s*(?:cc|cm3|cm³|毫升)/i)?.[1]);
  const powerHp = numeric(value.match(/([0-9]{2,4})\s*(?:马力|hp|ps)/i)?.[1]);
  const powerKw = numeric(value.match(/([0-9]{2,4})\s*kW\b/i)?.[1]);
  const fuel = /纯电|EV/i.test(value) ? "electric" : /增程/i.test(value) ? "range_extender" : /插电|PHEV/i.test(value) ? "phev" : /混动|双擎|hybrid/i.test(value) ? "hybrid" : /柴油|diesel/i.test(value) ? "diesel" : /汽油|petrol|gasoline/i.test(value) ? "petrol" : "";
  const transmission = /手动|MT\b/i.test(value) ? "manual" : /CVT|无级/i.test(value) ? "cvt" : /DCT|双离合|机器人/i.test(value) ? "robot" : /自动|AT\b/i.test(value) ? "automatic" : "";
  const drive = /四驱|AWD|4WD/i.test(value) ? "4wd" : /后驱|RWD/i.test(value) ? "rwd" : /前驱|FWD/i.test(value) ? "fwd" : /两驱|2WD/i.test(value) ? "2wd" : "";
  const bodyType = /MPV|商务车/i.test(value) ? "minivan" : /SUV|越野/i.test(value) ? "suv" : /旅行/i.test(value) ? "wagon" : /两厢/i.test(value) ? "hatchback" : /跑车|Coupe/i.test(value) ? "coupe" : /轿车|三厢/i.test(value) ? "sedan" : "";
  return { engineCc, powerHp, powerKw, fuel, transmission, drive, bodyType };
}

function cardImages(card: string, base: string) {
  return [...new Set([...card.matchAll(/(?:data-original|data-src|data-lazy-src|src)=["']([^"']+)["']/gi)]
    .map((match) => absoluteUrl(match[1], base))
    .filter((url) => /^https?:/i.test(url) && !BAD_IMAGE.test(url) && /\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url)))];
}

function coherentImages(markup: string, detailUrl: string) {
  const candidates = [
    ...[...markup.matchAll(/(?:data-original|data-src|data-lazy-src|src)=["']([^"']+)["']/gi)].map((match) => match[1]),
    ...[...markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\\\s<>]*)?/gi)].map((match) => match[0].replace(/\\\//g, "/")),
  ].map((value) => absoluteUrl(value, detailUrl)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE.test(url));
  const groups = new Map<string, string[]>();
  for (const url of [...new Set(candidates)]) {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split("/").filter(Boolean);
      const key = `${parsed.hostname}/${parts.slice(0, Math.max(1, parts.length - 1)).join("/")}`;
      groups.set(key, [...(groups.get(key) || []), url]);
    } catch { /* invalid source URL */ }
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  return (best && best.length >= 3 ? best : [...new Set(candidates)]).slice(0, 20);
}

function listRows(markup: string, listUrl: string) {
  const anchors = [...markup.matchAll(/<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const rows: DealerRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < anchors.length; index++) {
    const anchor = anchors[index];
    const detailUrl = absoluteUrl(anchor[1], listUrl);
    if (!detailUrl || seen.has(detailUrl) || /(?:carlist|videolist|shop\/dealer\/?$|index_|javascript:)/i.test(detailUrl)) continue;
    if (!/(?:che168\.com).*(?:dealer|car|spec|detail|ershouche).*(?:\d{6,})/i.test(detailUrl)) continue;
    // A listing card is the boundary: never borrow a neighbour's price/specs.
    const cardMatch = [...markup.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].find(match =>
      (match.index || 0) <= (anchor.index || 0) && (match.index || 0) + match[0].length > (anchor.index || 0));
    if (!cardMatch || !isAllowedCatalogSourceUrl("china", "autohome_used_china_open", detailUrl)) continue;
    const card = cardMatch[0];
    const plain = clean(card);
    if (!/[0-9.]+\s*万/.test(plain)) continue;
    const title = clean(anchor[2]) || clean(card.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i)?.[1]) || clean(card.match(/<img[^>]+alt=["']([^"']+)/i)?.[1]);
    const derived = deriveMakeModel(title);
    const registrationYear = Number(plain.match(/万公里\s*[／/|]\s*((?:19|20)\d{2})[-年]/)?.[1]);
    const titleYear = Number(title.match(/(?:19|20)\d{2}/)?.[0]);
    const year = registrationYear || titleYear;
    if (!derived.make || !derived.model || !year || year < 1985 || year > new Date().getFullYear() + 1) continue;
    const specs = specValues(`${title} ${plain}`);
    const id = detailUrl.match(/(?:\/|-)(\d{6,})(?:\.html|[/?#]|$)/i)?.[1] || stableOfferId("che168_dealer", detailUrl);
    seen.add(detailUrl);
    rows.push({
      id, detailUrl, title: derived.title, make: derived.make, model: derived.model, year,
      mileageKm: mileage(plain), price: priceCny(clean(card.match(/<([a-z][a-z0-9]*)\b[^>]*class=["'][^"']*(?:price|报价|售价)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i)?.[2] || "")), images: cardImages(card, listUrl),
      city: clean(plain.match(/[／/|]\s*([\u4e00-\u9fff]{2,8})\s*[0-9.]+\s*万/)?.[1]), ...specs,
    });
  }
  return rows;
}

export class Che168DealerAdapter implements CatalogSourceAdapter {
  sourceId = "che168_dealer_exact";
  market = "china" as const;
  accessMode = "public_html" as const;

  private exhaustedDealers = new Set<string>();

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    let cursorPage = Math.max(1, Number(cursor || 1));
    for (let checked = 0; checked < DEALERS.length; checked++, cursorPage++) {
      const dealerId = DEALERS[(cursorPage - 1) % DEALERS.length];
      if (this.exhaustedDealers.has(dealerId)) continue;
      const page = Math.floor((cursorPage - 1) / DEALERS.length) + 1;
      const urls = page === 1
        ? [`https://dealers.che168.com/shop/dealer/v2/carlist/${dealerId}.html`, `https://dealers.che168.com/shop/dealer/${dealerId}.html`]
        : [`https://dealers.che168.com/shop/dealer/v2/carlist/${dealerId}-${page}.html`, `https://dealers.che168.com/shop/dealer/${dealerId}-${page}.html`];
      for (const listUrl of urls) {
        const result = await fetchMarkup(listUrl);
        if ([401,403,429].includes(result.response.status) || /captcha|cf-chl|access denied/i.test(result.markup)) {
          return {items:[],finished:true,nextCursor:null,health:{ok:false,blocked:true,message:`che168_access_${result.response.status}`,checkedAt:new Date().toISOString()}};
        }
        if (!result.response.ok && result.response.status !== 404) throw new Error(`che168_list_http_${result.response.status}`);
        if (!result.response.ok) continue;
        const rows = listRows(result.markup, listUrl);
        if (rows.length) return {items:rows,nextCursor:String(cursorPage+1),finished:false,count:rows.length};
      }
      // An empty dealer must not prevent collecting the other independent dealers.
      this.exhaustedDealers.add(dealerId);
    }
    const finished=this.exhaustedDealers.size===DEALERS.length;
    return {items:[],nextCursor:finished?null:String(cursorPage),finished,count:0,
      health:{ok:true,message:`domestic dealer coverage ${DEALERS.length}; exhausted ${this.exhaustedDealers.size}`,checkedAt:new Date().toISOString()}};
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as DealerRow;
    if (!row.id || !row.make || !row.model || !row.year) return null;
    const now = new Date().toISOString();
    return normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, row.id), sourceId: this.sourceId, sourceOfferId: row.id, market: "china", offerType: "fixed", status: "active",
      make: row.make, model: row.model, trim: row.title, year: row.year, mileageKm: row.mileageKm, engineCc: row.engineCc, powerHp: row.powerHp,
      powerKw: row.powerKw, fuel: row.fuel, transmission: row.transmission, drive: row.drive, bodyType: row.bodyType,
      sourcePrice: row.price || null, sourceCurrency: row.price ? "CNY" : null, priceMode: row.price ? "fixed" : "estimated",
      images: [], totalRub: null, calculationStatus: row.price ? "ready" : "needs_data", firstSeenAt: now, updatedAt: now,
      operational: { sourceUrl: row.detailUrl, sourceVenueName: row.city || "Che168 dealer catalog", raw: row },
    } as VehicleOffer);
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const row = offer.operational.raw as DealerRow;
    let urls = row.images || [];
    const detail = await fetchMarkup(row.detailUrl, row.detailUrl).catch(() => null);
    if (detail?.response.ok) {
      const plain = clean(detail.markup);
      urls = coherentImages(detail.markup, row.detailUrl);
      const detailMileage = mileage(plain);
      const detailPrice = priceCny(plain);
      const specs = specValues(`${row.title} ${plain}`);
      if (detailMileage) offer.mileageKm = detailMileage;
      if (detailPrice) offer.sourcePrice = detailPrice;
      Object.assign(offer, Object.fromEntries(Object.entries(specs).filter(([, value]) => value)));
      (offer.operational as any).raw = { ...row, detailLoaded: true, images: urls };
    }
    const results = await Promise.all([...new Set(urls)].slice(0, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10)).map((url) =>
      cacheImageFromUrl(url, "china", { headers: { ...HEADERS, referer: row.detailUrl } }).catch(() => null),
    ));
    return results.filter((image): image is CatalogImage => Boolean(image && image.size > 8000));
  }

  async healthCheck() { return { ok: true, message: "Che168 exact dealer catalogs", checkedAt: new Date().toISOString() }; }
}

export const che168DealerExactSource = new Che168DealerAdapter();

/** Domestic Che168 collection; never falls back to the export API. */
export class DomesticChe168Adapter extends Che168DealerAdapter {
 sourceId = "autohome_used_china_open";
 async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
  // Traverse the domestic nationwide inventory before the dealer seed list.
  // A denied/challenged route stops collection; no Global/export substitution.
  if (cursor?.startsWith('dealer:')) {
   const page=await super.fetchPage(cursor.slice(7));
   return {...page,nextCursor:page.nextCursor?`dealer:${page.nextCursor}`:null};
  }
  const page=Math.max(1,Number(String(cursor || 'national:1').replace('national:','')) || 1);
  const url=`https://www.che168.com/china/a0_0msdgscncgpi1ltocsp${page}exx0/`;
  const {response,markup}=await fetchMarkup(url);
  if ([401,403,429].includes(response.status) || /captcha|cf-chl|access denied|Security Verification|window\.solveChallenge/i.test(markup)) {
   return {items:[],finished:true,nextCursor:null,health:{ok:false,blocked:true,message:`che168_national_access_${response.status}`,checkedAt:new Date().toISOString()}};
  }
  if (!response.ok && response.status!==404) throw Error(`che168_national_http_${response.status}`);
  const items=response.ok?listRows(markup,url):[];
  return {items,finished:false,nextCursor:items.length?`national:${page+1}`:'dealer:1',count:items.length,
   health:{ok:true,message:`Che168 domestic national page=${page} listings=${items.length}`,checkedAt:new Date().toISOString()}};
 }
 normalizeOffer(raw: unknown): VehicleOffer | null {
  const offer=super.normalizeOffer(raw), row=raw as DealerRow;
  if (!offer || !isAllowedCatalogSourceUrl("china",this.sourceId,row.detailUrl)) return null;
  // Do not promote the model's nominal 1.5L label to an exact 1500 cm³.
  offer.engineCc=row.engineCc;
  offer.powerHp=row.powerHp;
  offer.fuel=row.fuel;
  offer.operational.semanticEvidence={
   year:{source:'che168_domestic_listing',status:'exact',value:row.year},
   fuel:{source:'che168_domestic_listing',status:offer.fuel?'exact':'missing',value:offer.fuel},
   powertrainKind:{source:'che168_domestic_listing',status:offer.powertrainKind && offer.powertrainKind!=='unknown'?'exact':'missing',value:offer.powertrainKind},
   engineCc:{source:"che168_domestic_listing",status:row.engineCc?"exact":"missing",value:row.engineCc,rawValues:[]},
   powerHp:{source:"che168_domestic_listing",status:row.powerHp?"exact":"missing",value:row.powerHp,rawValues:[]},
  };
  offer.operational.exactDetail=false;
  // listRows extracts each gallery only from the <li> containing this URL.
  // Record that binding so the publication gate can distinguish it from an
  // unscoped page gallery. Empty galleries never receive an attestation.
  offer.operational.photoIdentityVerified=Boolean(row.images?.length);
  offer.operational.gallerySafetyMode='che168_domestic_listing_bound';
  if(row.powerHp){offer.powerDataSource='che168_domestic_listing';offer.powerDataConfidence='source_exact';}
  return offer;
 }
 async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
  const row = offer.operational.raw as DealerRow;
  if (!isAllowedCatalogSourceUrl("china",this.sourceId,row.detailUrl)) throw new Error("che168_non_domestic_url");
  // Preserve only photographs bound to this listing. Unknown detail schemas
  // must not turn neighbouring cars into the gallery or trigger blob uploads.
  return [...new Set(row.images || [])].slice(0,30).map(url=>({id:"",url,objectKey:"",checksum:"",size:0,mimeType:"image/jpeg"}));
 }
 async healthCheck() {
  try { const page=await this.fetchPage(); return {ok:page.items.length>0,message:"Che168 domestic dealer listings",checkedAt:new Date().toISOString()}; }
  catch(error) { return {ok:false,message:String(error),checkedAt:new Date().toISOString()}; }
 }
}
export const domesticChe168Source = new DomesticChe168Adapter();
