import { CATALOG_BRANDS } from "./brands";

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
  [/스바루/gi, "Subaru"],
  [/미쓰비시/gi, "Mitsubishi"],
  [/스즈키/gi, "Suzuki"],
  [/랜드로버/gi, "Land Rover"],
  [/포르쉐/gi, "Porsche"],
  [/캐딜락/gi, "Cadillac"],
  [/재규어/gi, "Jaguar"],
  [/테슬라/gi, "Tesla"],
  [/零跑汽车|零跑/g, "Leapmotor "],
  [/AITO\s*问界|问界/g, "AITO "],
  [/智己汽车|智己/g, "IM Motors "],
  [/智界/g, "Luxeed "],
  [/享界/g, "Stelato "],
  [/尊界/g, "Maextro "],
  [/阿维塔/g, "Avatr "],
  [/深蓝汽车|深蓝/g, "Deepal "],
  [/岚图汽车|岚图/g, "Voyah "],
  [/吉利银河/g, "Geely Galaxy "],
  [/长安启源/g, "Changan Qiyuan "],
  [/ARCFOX极狐|极狐/g, "Arcfox "],
  [/广汽埃安|埃安/g, "GAC Aion "],
  [/广汽昊铂|昊铂/g, "Hyptec "],
  [/东风奕派/g, "Dongfeng eπ "],
  [/奇瑞风云/g, "Chery Fulwin "],
  [/QQ冰淇淋/g, "QQ Ice Cream "],
  [/华凯新能源/g, "Huakai EV "],
  [/华凯/g, "Huakai "],
  [/蛟龙新能源/g, "Jiaolong EV "],
  [/雅升汽车|雅升/g, "Yasheng "],
  [/AM晓澳汽车|AM晓奥汽车|晓澳汽车|晓奥汽车|晓澳|晓奥/g, "Xiaoao "],
  [/LIMGENE凌际|凌际/g, "Limgene "],
  [/奇瑞QQ/g, "Chery "],
  [/星途/g, "Exeed "],
  [/星纪元/g, "Exlantix "],
  [/猛士/g, "M-Hero "],
  [/奔腾/g, "Bestune "],
  [/别克/g, "Buick "],
  [/五菱汽车|五菱/g, "Wuling "],
  [/吉利雷达/g, "Radar "],
  [/领克/g, "Lynk & Co "],
  [/欧拉/g, "Ora "],
  [/魏牌/g, "Wey "],
  [/方程豹/g, "Fangchengbao "],
  [/仰望/g, "Yangwang "],
  [/宝骏/g, "Baojun "],
  [/荣威/g, "Roewe "],
  [/名爵/g, "MG "],
  [/极石/g, "Rox "],
  [/东风纳米/g, "Dongfeng Nammi "],
  [/东风风神/g, "Dongfeng Aeolus "],
  [/启辰/g, "Venucia "],
  [/广汽传祺/g, "GAC Trumpchi "],
  [/一汽奔腾/g, "Bestune "],
  [/普拉多/g, "Prado "],
  [/汉兰达/g, "Highlander "],
  [/皇冠陆放/g, "Crown Kluger "],
  [/锋兰达/g, "Frontlander "],
  [/威兰达/g, "Wildlander "],
  [/RAV4荣放|荣放/g, "RAV4 "],
  [/兰德酷路泽/g, "Land Cruiser "],
  [/赛那/g, "Sienna "],
  [/格瑞维亚/g, "Granvia "],
  [/飞度/g, "Fit "],
  [/缤智/g, "Vezel "],
  [/奥德赛/g, "Odyssey "],
  [/途观L/g, "Tiguan L "],
  [/途昂/g, "Teramont "],
  [/迈腾/g, "Magotan "],
  [/探岳/g, "Tayron "],
  [/速腾/g, "Sagitar "],
  [/朗逸/g, "Lavida "],
  [/宝来/g, "Bora "],
  [/高尔夫/g, "Golf "],
  [/凌渡/g, "Lamando "],
  [/途岳/g, "Tharu "],
  [/([357])系/g, "$1 Series "],
  [/上汽跃进/g, "Yuejin "],
  [/新龙马汽车/g, "New Longma "],
  [/东风风行/g, "Forthing "],
  [/北京汽车制造厂/g, "BAW "],
  [/北京越野/g, "BAIC "],
  [/江汽集团/g, "JAC "],
  [/江淮瑞风/g, "JAC Refine "],
  [/东风风度/g, "Dongfeng Fengdu "],
  [/中国重汽/g, "Sinotruk "],
  [/吉利汽车/g, "Geely "],
  [/长城汽车/g, "Great Wall "],
  [/东风/g, "Dongfeng "],
  [/大通/g, "Maxus "],
  [/五十铃/g, "Isuzu "],
  [/福田/g, "Foton "],
  [/江铃/g, "JMC "],
  [/中兴/g, "ZX "],
  [/红旗/g, "Hongqi "],
  [/捷达/g, "Jetta "],
  [/长城/g, "Great Wall "],
  [/大运/g, "Dayun "],
  [/凯翼/g, "Kaiyi "],
  [/黄海/g, "Huanghai "],
  [/跃进/g, "Yuejin "],
  [/帝豪/g, "Emgrand "],
  [/菱智/g, "Lingzhi "],
  [/凯美瑞/g, "Camry "],
  [/雷凌/g, "Levin "],
  [/亚洲龙/g, "Avalon "],
  [/帕萨特/g, "Passat "],
  [/狮铂拓界/g, "Sportage "],
  [/卡罗拉/g, "Corolla "],
  [/轩逸/g, "Sylphy "],
  [/天籁/g, "Teana "],
  [/逍客/g, "Qashqai "],
  [/奇骏/g, "X-Trail "],
  [/雅阁/g, "Accord "],
  [/思域/g, "Civic "],
  [/秦PLUS/g, "Qin PLUS "],
  [/宋PLUS/g, "Song PLUS "],
  [/海豹/g, "Seal "],
  [/海豚/g, "Dolphin "],
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
  [/林肯/g, "Lincoln "],
  [/玛莎拉蒂/g, "Maserati "],
  [/标致/g, "Peugeot "],
  [/宾利/g, "Bentley "],
  [/阿斯顿[·・]?马丁/g, "Aston Martin "],
  [/莲花跑车|路特斯/g, "Lotus "],
  [/雪铁龙/g, "Citroen "],
  [/小米汽车|小米/g, "Xiaomi "],
  [/法拉利/g, "Ferrari "],
  [/英菲尼迪/g, "Infiniti "],
  [/捷豹/g, "Jaguar "],
  [/兰博基尼/g, "Lamborghini "],
  [/阿尔法[·・]?罗密欧/g, "Alfa Romeo "],
  [/创维汽车|创维/g, "Skyworth "],
  [/威麟/g, "Rely "],
  [/北京汽车/g, "BAIC "],
  [/睿蓝汽车|睿蓝/g, "Livan "],
  [/江淮钇为|钇为/g, "JAC Yiwei "],
  [/思皓/g, "Sehol "],
  [/远程/g, "Farizon "],
  [/东南/g, "Soueast "],
  [/凌宝汽车|凌宝/g, "Lingbox "],
  [/知豆/g, "Zhidou "],
  [/乐道/g, "Onvo "],
  [/英力士掷弹兵/g, "Ineos Grenadier "],
  [/钧天纵横家/g, "Juntian Zonghengjia "],
  [/钧天机械|钧天汽车|钧天/g, "Juntian "],
  [/比亚迪/g, "BYD "],
  [/吉利/g, "Geely "],
  [/长安/g, "Changan "],
  [/奇瑞/g, "Chery "],
  [/开瑞/g, "Karry "],
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
  [/더\s*뉴\s*렉스턴\s*스포츠\s*칸/gi, "The New Rexton Sports Khan"],
  [/렉스턴\s*스포츠\s*칸/gi, "Rexton Sports Khan"],
  [/더\s*뉴\s*레이/gi, "The New Ray"],
  [/모하비/gi, "Mohave"],
  [/쿠퍼/gi, "Cooper"],
  [/디스커버리/gi, "Discovery"],
  [/레니게이드/gi, "Renegade"],
  [/포터/gi, "Porter"],
  [/그란투리스모/gi, "Gran Turismo"],
  [/팰리세이드/gi, "Palisade"],
  [/아베오/gi, "Aveo"],
  [/프라이드/gi, "Pride"],
  [/트랙스/gi, "Trax"],
  [/티볼리/gi, "Tivoli"],
  [/익스플로러/gi, "Explorer"],
  [/벨로스터/gi, "Veloster"],
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
  [/(?<![가-힣])레이(?![가-힣])/gi, "Ray"],
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
  return objectText(value)
    .replace(/\[object Object\]/gi, "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function translateCatalogText(value: unknown) {
  let text = safeCatalogText(value).normalize("NFKC");
  for (const [pattern, replacement] of directPhrases) text = text.replace(pattern, replacement);
  text = text
    .replace(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff\uf900-\ufaff\uff61-\uff9f]+/gu, " ")
    .replace(/([0-9]{4})款/g, "$1 ")
    .replace(/\s*[·|]+\s*/g, " ")
    .replace(/\s+-\s+/g, " ")
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

function stripUnresolvedHan(value: string) {
  return value
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIdentityLabel(value: string) {
  return String(value || "")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150)
    .trim();
}

function normalizedIdentity(value: unknown) {
  return safeCatalogText(value).normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function nativeSourceIdentity(value: unknown) {
  return cleanIdentityLabel(safeCatalogText(value).normalize("NFKC"));
}

function publicMarketIdentity(value: unknown, marketValue: unknown) {
  const translated = cleanIdentityLabel(compactListingText(value));
  if (translated) return translated;
  // Public identity is fail-closed. A native-source fallback is useful in the
  // internal enrichment queue, but it must never leak Korean/Japanese/Chinese
  // text back into a customer-facing title.
  void marketValue;
  return "";
}

function isChinaOffer(offer: any) {
  return safeCatalogText(offer?.market).toLowerCase() === "china";
}

const catalogBrandsByLength = [...CATALOG_BRANDS]
  .sort((left, right) => right.name.length - left.name.length);

function knownCatalogBrandInText(value: unknown) {
  const translated = compactListingText(value);
  if (!translated) return "";
  const normalized = ` ${translated.toLocaleLowerCase("en-US").replace(/[^a-z0-9&+-]+/g, " ")} `;
  for (const brand of catalogBrandsByLength) {
    const candidate = brand.name.toLocaleLowerCase("en-US").replace(/[^a-z0-9&+-]+/g, " ").trim();
    if (candidate && normalized.includes(` ${candidate} `)) return brand.name;
  }
  return "";
}

function publicChinaMake(offer: any) {
  const translated = cleanIdentityLabel(compactListingText(offer?.make));
  const cleaned = stripUnresolvedHan(translated);
  if (cleaned) return cleaned;

  for (const candidate of [offer?.sourceTitle, offer?.model, offer?.operational?.sourceTitle]) {
    const brand = knownCatalogBrandInText(candidate);
    if (brand) return brand;
  }

  return nativeSourceIdentity(offer?.make);
}

function publicChinaModel(offer: any) {
  const publicMake = publicChinaMake(offer);
  const translated = cleanIdentityLabel(compactListingText(offer?.model));
  const translatedIsUseful = translated
    && normalizedIdentity(translated) !== normalizedIdentity(publicMake)
    && !/^(?:PLUS|PRO|MAX|EV|PHEV|HEV|BEV)$/i.test(translated);
  if (translatedIsUseful) return translated;

  const sourceModel = nativeSourceIdentity(offer?.model);
  const sourceMake = nativeSourceIdentity(offer?.make);
  if (!sourceModel) return "";
  if (sourceMake && sourceModel.startsWith(sourceMake) && sourceModel !== sourceMake) {
    const withoutMake = cleanIdentityLabel(sourceModel.slice(sourceMake.length));
    if (withoutMake) return withoutMake;
  }
  return sourceModel;
}

function publicTitleTrim(value: unknown) {
  const original = compactListingText(value);
  if (!original) return "";
  const cleaned = original
    .replace(/[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7af\ud7b0-\ud7ff\uf900-\ufaff\uff61-\uff9f]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[A-Za-zА-Яа-яЁё]/u.test(cleaned) ? cleaned : "";
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
  if (/栏板|仓栅|货车|微卡/.test(text)) return "Малотоннажный грузовик";
  if (/\b(carnival|staria|starex|grand starex|h-1|mpv|minivan|минивэн|odyssey|sienna|alphard|vellfire|serena|noah|voxy)\b/.test(text)) return "Минивэн";
  if (/\bbmw\b/.test(text) && /\b(x1|x2|x3|x4|x5|x6|x7)\b/.test(text)) return "Кроссовер";
  if (/\b(gv60|gv70|gv80|tucson|santa fe|santafe|sorento|sportage|palisade|kona|seltos|casper|venue|niro|glc|gle|gls|q3|q5|q7|q8|rav4|harrier|cr-v|vezel|cx-3|cx-30|cx-4|cx-5|cx-8|cx-9|suv|crossover|кроссовер|внедорожник)\b/.test(text)) return "Кроссовер";
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
  const gears = Number(raw.match(/(?:^|\D)(\d{1,2})[-\s]*(?:挡|speed|speeds|gear|gears|gang|ступ)/i)?.[1] || 0);
  const label = (name: string) => gears > 0 && gears <= 12 ? `${gears}-ступ. ${name}` : name;
  if (/电动车?单速变速箱|电动汽车单速变速箱|单速变速箱|固定齿比|固定传动比|single[- ]?speed|1[- ]?speed/.test(raw)) return "одноступенчатый редуктор";
  if (/电子无级变速|e[- ]?cvt/.test(raw)) return "вариатор (e-CVT)";
  if (/cvt|无级变速|вариатор/.test(raw)) return "вариатор";
  if (/robot|dct|dsg|pdk|dual[- ]?clutch|double[- ]?clutch|双离合|робот|semi[- ]?automatic/.test(raw)) return label("робот");
  if (/manual|(?:^|\W)mt(?:$|\W)|stick[- ]?shift|手动|수동|механик/.test(raw) && !/手自一体/.test(raw)) return label("механика");
  if (/automatic|automatik|auto|(?:^|\W)at(?:$|\W)|tiptronic|steptronic|tronic|手自一体|自动挡?|오토|자동|автомат/.test(raw)) return label("автомат");
  return "уточняется";
}

export function catalogDriveName(value: unknown) {
  const raw = safeCatalogText(value).toLowerCase();
  if (!raw) return "уточняется";
  if (/4wd|awd|4x4|four[- ]?wheel|all[- ]?wheel|quattro|xdrive|4matic|四驱|사륜|полный/.test(raw)) return "полный";
  if (/fwd|2wd|front[- ]?wheel|前驱|两驱|전륜|передн/.test(raw)) return "передний";
  if (/rwd|rear[- ]?wheel|后驱|후륜|задн/.test(raw)) return "задний";
  return "уточняется";
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

function normalizedTitleToken(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

function collapseAdjacentRepeatedPhrases(value: string) {
  const tokens = value.split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    const maxPhraseLength = Math.min(8, Math.floor(tokens.length / 2));
    outer: for (let phraseLength = maxPhraseLength; phraseLength >= 1; phraseLength--) {
      for (let start = 0; start + phraseLength * 2 <= tokens.length; start++) {
        const left = tokens.slice(start, start + phraseLength).map(normalizedTitleToken).join(" ");
        const right = tokens.slice(start + phraseLength, start + phraseLength * 2).map(normalizedTitleToken).join(" ");
        if (!left || left !== right) continue;
        tokens.splice(start + phraseLength, phraseLength);
        changed = true;
        break outer;
      }
    }
  }
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

export function catalogOfferTitle(offer: any) {
  const china = isChinaOffer(offer);
  const market = safeCatalogText(offer?.market).toLowerCase();
  const make = china ? publicChinaMake(offer) : publicMarketIdentity(offer?.make, market);
  const model = china ? publicChinaModel(offer) : publicMarketIdentity(offer?.model, market);
  const rawBase = model && make && normalizedIdentity(model).startsWith(`${normalizedIdentity(make)} `)
    ? model
    : [make, model].filter(Boolean).join(" ").trim();
  const base = collapseAdjacentRepeatedPhrases(china ? rawBase : stripUnresolvedHan(rawBase));

  let trim = china ? "" : collapseAdjacentRepeatedPhrases(publicTitleTrim(offer?.trim));
  if (/^(?:other|другое|прочее|прочий|unknown|n\/?a)$/i.test(trim)) trim = "";
  trim = removeLeadingPhrase(trim, base);
  trim = removeLeadingPhrase(trim, make);
  trim = removeLeadingPhrase(trim, model);
  if (trim && base && trim.toLocaleLowerCase("en-US").includes(base.toLocaleLowerCase("en-US"))) {
    trim = trim.slice(0, trim.toLocaleLowerCase("en-US").indexOf(base.toLocaleLowerCase("en-US"))).trim();
  }

  const combined = collapseAdjacentRepeatedPhrases([base, trim]
    .filter(Boolean)
    .join(" "))
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
  const market = safeCatalogText(offer?.market).toLowerCase();
  return {
    ...offer,
    title: catalogOfferTitle(offer),
    makeLabel: isChinaOffer(offer) ? publicChinaMake(offer) : publicMarketIdentity(offer?.make, market),
    modelLabel: isChinaOffer(offer) ? collapseAdjacentRepeatedPhrases(publicChinaModel(offer)) : collapseAdjacentRepeatedPhrases(publicMarketIdentity(offer?.model, market)),
    trimLabel: collapseAdjacentRepeatedPhrases(publicTitleTrim(offer?.trim)),
    marketLabel: catalogMarketName(offer?.market),
    bodyLabel: catalogBodyName(offer?.bodyType, offer),
    fuelLabel: catalogFuelName(offer?.fuel),
    transmissionLabel: catalogTransmissionName(offer?.transmission),
    driveLabel: catalogDriveName(offer?.drive),
    images,
  };
}
