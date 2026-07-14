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
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function translateCatalogText(value: unknown) {
  let text = safeCatalogText(value);
  for (const [pattern, replacement] of directPhrases) text = text.replace(pattern, replacement);
  text = text
    .replace(/[가-힣]+/g, " ")
    .replace(/\s*[-·|]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function catalogMarketName(value: unknown) {
  const key = safeCatalogText(value).toLowerCase();
  return marketNames[key] || translateCatalogText(value) || "Рынок уточняется";
}

export function catalogBodyName(value: unknown) {
  const raw = safeCatalogText(value);
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  return bodyNames[key] || translateCatalogText(raw) || "Автомобиль";
}

export function catalogFuelName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/gasoline|petrol|가솔린|бенз/.test(raw)) return "бензин";
  if (/diesel|디젤|диз/.test(raw)) return "дизель";
  if (/hybrid|하이브리드|гибрид/.test(raw)) return "гибрид";
  if (/electric|ev|전기|электро/.test(raw)) return "электро";
  if (/lpg|газ/.test(raw)) return "газ";
  return translateCatalogText(raw) || "уточняется";
}

export function catalogTransmissionName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/automatic|auto|at|오토|자동/.test(raw)) return "автомат";
  if (/manual|mt|수동/.test(raw)) return "механика";
  if (/cvt|вариатор/.test(raw)) return "вариатор";
  if (/robot|dct|робот/.test(raw)) return "робот";
  return translateCatalogText(raw) || "уточняется";
}

export function catalogDriveName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/4wd|awd|사륜|полный/.test(raw)) return "полный";
  if (/fwd|2wd|전륜|передн/.test(raw)) return "передний";
  if (/rwd|후륜|задн/.test(raw)) return "задний";
  return translateCatalogText(raw) || "уточняется";
}

export function catalogOfferTitle(offer: any) {
  const make = translateCatalogText(offer?.make);
  const model = translateCatalogText(offer?.model);
  const trim = translateCatalogText(offer?.trim);
  const combined = [make, model, trim]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
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
    makeLabel: translateCatalogText(offer?.make) || "Марка уточняется",
    modelLabel: translateCatalogText(offer?.model) || "Модель уточняется",
    trimLabel: translateCatalogText(offer?.trim),
    marketLabel: catalogMarketName(offer?.market),
    bodyLabel: catalogBodyName(offer?.bodyType),
    fuelLabel: catalogFuelName(offer?.fuel),
    transmissionLabel: catalogTransmissionName(offer?.transmission),
    driveLabel: catalogDriveName(offer?.drive),
    images,
  };
}
