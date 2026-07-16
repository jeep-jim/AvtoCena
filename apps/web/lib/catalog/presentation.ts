const directPhrases: Array<[RegExp, string]> = [
  [/쉐보레\s*\(GM대우\)/gi, "Chevrolet"],
  [/쉐보레/gi, "Chevrolet"],
  [/현대/gi, "Hyundai"],
  [/기아/gi, "Kia"],
  [/벤츠/gi, "Mercedes-Benz"],
  [/제네시스/gi, "Genesis"],
  [/쌍용|KG모빌리티/gi, "KGM"],
  [/르노코리아|르노삼성/gi, "Renault Korea"],
  [/아우디/gi, "Audi"],
  [/폭스바겐/gi, "Volkswagen"],
  [/미니/gi, "MINI"],
  [/볼보/gi, "Volvo"],
  [/렉서스/gi, "Lexus"],
  [/토요타/gi, "Toyota"],
  [/혼다/gi, "Honda"],
  [/닛산/gi, "Nissan"],
  [/랜드로버/gi, "Land Rover"],
  [/포르쉐/gi, "Porsche"],
  [/테슬라/gi, "Tesla"],
  [/雷克萨斯/g, "Lexus "],
  [/梅赛德斯[-·]?奔驰|奔驰/g, "Mercedes-Benz "],
  [/宝马/g, "BMW "],
  [/奥迪/g, "Audi "],
  [/大众/g, "Volkswagen "],
  [/丰田/g, "Toyota "],
  [/本田/g, "Honda "],
  [/日产/g, "Nissan "],
  [/马自达/g, "Mazda "],
  [/三菱/g, "Mitsubishi "],
  [/斯巴鲁/g, "Subaru "],
  [/现代/g, "Hyundai "],
  [/起亚/g, "Kia "],
  [/捷尼赛思/g, "Genesis "],
  [/沃尔沃/g, "Volvo "],
  [/保时捷/g, "Porsche "],
  [/福特/g, "Ford "],
  [/雪佛兰/g, "Chevrolet "],
  [/凯迪拉克/g, "Cadillac "],
  [/路虎/g, "Land Rover "],
  [/特斯拉/g, "Tesla "],
  [/比亚迪/g, "BYD "],
  [/吉利/g, "Geely "],
  [/长安/g, "Changan "],
  [/奇瑞/g, "Chery "],
  [/哈弗/g, "Haval "],
  [/广汽/g, "GAC "],
  [/理想/g, "Li Auto "],
  [/蔚来/g, "Nio "],
  [/小鹏/g, "XPeng "],
  [/极氪/g, "Zeekr "],
  [/捷途/g, "Jetour "],
  [/腾势/g, "Denza "],
  [/坦克/g, "Tank "],
  [/城市版/g, "City "],
  [/新上架|二手车|准新车|在售|报价|图片|详情/g, " "],
  [/더\s*뉴\s*스파크/gi, "The New Spark"],
  [/더\s*뉴\s*팰리세이드/gi, "The New Palisade"],
  [/더\s*뉴\s*그랜저/gi, "The New Grandeur"],
  [/더\s*뉴\s*레이/gi, "The New Ray"],
  [/캐스퍼/gi, "Casper"],
  [/스타리아/gi, "Staria"],
  [/카니발/gi, "Carnival"],
  [/그랜저/gi, "Grandeur"],
  [/아반떼/gi, "Avante"],
  [/쏘나타/gi, "Sonata"],
  [/투싼/gi, "Tucson"],
  [/싼타페/gi, "Santa Fe"],
  [/코나/gi, "Kona"],
  [/아이오닉/gi, "Ioniq"],
  [/베뉴/gi, "Venue"],
  [/쏘렌토/gi, "Sorento"],
  [/스포티지/gi, "Sportage"],
  [/셀토스/gi, "Seltos"],
  [/모닝/gi, "Morning"],
  [/레이/gi, "Ray"],
  [/니로/gi, "Niro"],
  [/스팅어/gi, "Stinger"],
  [/카렌스/gi, "Carens"],
  [/라운지/gi, "Lounge"],
  [/인스퍼레이션/gi, "Inspiration"],
  [/프레스티지/gi, "Prestige"],
  [/시그니처/gi, "Signature"],
  [/캘리그래피/gi, "Calligraphy"],
  [/그래비티/gi, "Gravity"],
  [/프리미엄/gi, "Premium"],
  [/모던/gi, "Modern"],
  [/베스트\s*셀렉션/gi, "Best Selection"],
  [/터보/gi, "Turbo"],
  [/가솔린/gi, "бензин"],
  [/디젤/gi, "дизель"],
  [/하이브리드/gi, "гибрид"],
  [/전기/gi, "электро"],
  [/오토|자동/gi, "автомат"],
  [/수동/gi, "механика"],
  [/륜구동/gi, "привод"],
  [/전륜/gi, "передний привод"],
  [/후륜/gi, "задний привод"],
  [/사륜/gi, "полный привод"],
  [/([0-9]+)인승/gi, "$1 мест"],
  [/4세대/gi, "IV"],
  [/5세대/gi, "V"],
  [/3세대/gi, "III"],
  [/2세대/gi, "II"],
  [/1세대/gi, "I"],
  [/클래스/gi, "Class"],
];

const marketNames: Record<string, string> = {
  japan: "Япония",
  korea: "Корея",
  china: "Китай",
  uae: "ОАЭ",
  europe: "Европа",
};

const bodyNames: Record<string, string> = {
  suv: "Кроссовер",
  crossover: "Кроссовер",
  offroad: "Внедорожник",
  sedan: "Седан",
  saloon: "Седан",
  hatchback: "Хэтчбек",
  wagon: "Универсал",
  estate: "Универсал",
  coupe: "Купе",
  convertible: "Кабриолет",
  cabrio: "Кабриолет",
  minivan: "Минивэн",
  mpv: "Минивэн",
  van: "Фургон",
  pickup: "Пикап",
};

const japaneseLocationTail = /\b(?:Hokkaido|Aomori|Iwate|Miyagi|Akita|Yamagata|Fukushima|Ibaraki|Tochigi|Gunma|Saitama|Chiba|Tokyo|Kanagawa|Niigata|Toyama|Ishikawa|Fukui|Yamanashi|Nagano|Gifu|Shizuoka|Aichi|Mie|Shiga|Kyoto|Osaka|Hyogo|Nara|Wakayama|Tottori|Shimane|Okayama|Hiroshima|Yamaguchi|Tokushima|Kagawa|Ehime|Kochi|Fukuoka|Saga|Nagasaki|Kumamoto|Oita|Miyazaki|Kagoshima|Okinawa)\s+Japan\b[\s\S]*$/i;

function objectText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(objectText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "Name", "title", "Title", "label", "Label", "text", "Text", "value", "Value", "displayName", "DisplayName"]) {
      const text = objectText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

export function safeCatalogText(value: unknown) {
  const text = objectText(value)
    .replace(/\[object Object\]/gi, "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function translateCatalogText(value: unknown) {
  let text = safeCatalogText(value);
  for (const [pattern, replacement] of directPhrases) text = text.replace(pattern, replacement);
  text = text
    .replace(/[가-힣]+/g, " ")
    .replace(/([0-9]{4})款/g, "$1 ")
    .replace(/\s*[-·|]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

function compactListingText(value: unknown) {
  return translateCatalogText(value)
    .replace(/\b(?:Japan Car Price|Estimated Total Price|Total Price|Car Price)\b[\s\S]*$/i, "")
    .replace(/\(\s*FOB\s*\)/gi, " ")
    .replace(japaneseLocationTail, "")
    .replace(/[¥￥$€]\s*[0-9][0-9,\.\s]*/g, " ")
    .replace(/\b(?:19|20)\d{2}[./-]\d{1,2}(?:[./-]\d{1,2})?(?:\s+\d{1,2}[.:]\d{2})?[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .trim();
}

export function catalogMarketName(value: unknown) {
  const key = safeCatalogText(value).toLowerCase();
  return marketNames[key] || translateCatalogText(value) || "Рынок уточняется";
}

function inferBodyFromOffer(offer: any) {
  const text = translateCatalogText([
    offer?.make,
    offer?.model,
    offer?.generation,
    offer?.trim,
    offer?.bodyType,
  ]).toLowerCase();

  if (!text) return "";
  if (/\b(coupe|купе)\b|쿠페/.test(text)) return "Купе";
  if (/\b(convertible|cabrio|roadster|кабриолет)\b/.test(text)) return "Кабриолет";
  if (/\b(wagon|estate|touring|avant|универсал)\b/.test(text)) return "Универсал";
  if (/\b(pickup|пикап|double cab)\b/.test(text)) return "Пикап";
  if (/\b(cargo|panel van|фургон)\b/.test(text)) return "Фургон";
  if (/\b(carnival|staria|starex|grand starex|h-1|mpv|minivan|минивэн|odyssey|sienna|alphard|vellfire|serena|noah|voxy)\b/.test(text)) return "Минивэн";
  if (/\b(gv60|gv70|gv80|tucson|santa fe|santafe|sorento|sportage|palisade|kona|seltos|casper|venue|niro|glc|gle|gls|x1|x2|x3|x4|x5|x6|x7|q3|q5|q7|q8|rav4|harrier|cr-v|vezel|cx-3|cx-30|cx-4|cx-5|cx-8|cx-9|suv|crossover|кроссовер|внедорожник)\b/.test(text)) return "Кроссовер";
  if (/\b(spark|morning|picanto|ray|i10|i20|i30|golf|hatchback|хэтчбек)\b/.test(text)) return "Хэтчбек";
  if (/\b(g70|g80|g90|sonata|avante|elantra|grandeur|azera|k3|k5|k7|k8|camry|corolla|accord|civic|sedan|saloon|седан|e class|cls|s class|a6|a8|3 series|5 series|7 series)\b/.test(text)) return "Седан";
  return "";
}

export function catalogBodyName(value: unknown, offer?: any) {
  const raw = safeCatalogText(value);
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (bodyNames[key]) return bodyNames[key];

  const translated = translateCatalogText(raw);
  const translatedKey = translated.toLowerCase().replace(/[^a-z]/g, "");
  if (bodyNames[translatedKey]) return bodyNames[translatedKey];

  return inferBodyFromOffer(offer) || "уточняется";
}

export function catalogFuelName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/gasoline|petrol|汽油|가솔린|бенз/.test(raw)) return "бензин";
  if (/diesel|柴油|디젤|диз/.test(raw)) return "дизель";
  if (/hybrid|混合动力|하이브리드|гибрид/.test(raw)) return "гибрид";
  if (/electric|纯电|ev|전기|электро/.test(raw)) return "электро";
  if (/lpg|газ/.test(raw)) return "газ";
  return translateCatalogText(raw) || "уточняется";
}

export function catalogTransmissionName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/automatic|auto|at|自动|오토|자동/.test(raw)) return "автомат";
  if (/manual|mt|手动|수동/.test(raw)) return "механика";
  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";
  if (/robot|dct|双离合|робот/.test(raw)) return "робот";
  return translateCatalogText(raw) || "уточняется";
}

export function catalogDriveName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/4wd|awd|四驱|사륜|полный/.test(raw)) return "полный";
  if (/fwd|2wd|前驱|两驱|전륜|передн/.test(raw)) return "передний";
  if (/rwd|后驱|후륜|задн/.test(raw)) return "задний";
  return translateCatalogText(raw) || "уточняется";
}

function removeLeadingPhrase(value: string, phrase: string) {
  if (!phrase) return value;
  const normalizedValue = value.toLocaleLowerCase("en-US");
  const normalizedPhrase = phrase.toLocaleLowerCase("en-US");
  return normalizedValue === normalizedPhrase
    ? ""
    : normalizedValue.startsWith(`${normalizedPhrase} `)
      ? value.slice(phrase.length).trim()
      : value;
}

export function catalogOfferTitle(offer: any) {
  const make = compactListingText(offer?.make);
  const model = compactListingText(offer?.model);
  const base = model && make && model.toLocaleLowerCase("en-US").startsWith(make.toLocaleLowerCase("en-US"))
    ? model
    : [make, model].filter(Boolean).join(" ").trim();

  let trim = compactListingText(offer?.trim);
  trim = removeLeadingPhrase(trim, base);
  trim = removeLeadingPhrase(trim, make);
  trim = removeLeadingPhrase(trim, model);
  if (trim && base && trim.toLocaleLowerCase("en-US").includes(base.toLocaleLowerCase("en-US"))) {
    trim = trim.slice(0, trim.toLocaleLowerCase("en-US").indexOf(base.toLocaleLowerCase("en-US"))).trim();
  }

  const combined = [base, trim]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 16)
    .join(" ")
    .slice(0, 140)
    .trim();

  if (combined) return combined;
  return `${catalogMarketName(offer?.market)} · автомобиль ${offer?.year || ""}`.trim();
}

export function presentCatalogOffer(offer: any) {
  const images = Array.isArray(offer?.images)
    ? offer.images.map((image: any) => safeCatalogText(image?.url)).filter(Boolean)
    : [];
  return {
    ...offer,
    title: catalogOfferTitle(offer),
    makeLabel: compactListingText(offer?.make) || "Марка уточняется",
    modelLabel: compactListingText(offer?.model) || "Модель уточняется",
    trimLabel: compactListingText(offer?.trim),
    marketLabel: catalogMarketName(offer?.market),
    bodyLabel: catalogBodyName(offer?.bodyType, offer),
    fuelLabel: catalogFuelName(offer?.fuel),
    transmissionLabel: catalogTransmissionName(offer?.transmission),
    driveLabel: catalogDriveName(offer?.drive),
    images,
  };
}
