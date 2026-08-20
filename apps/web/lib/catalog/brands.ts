export type CatalogBrand = {
  name: string;
  slug: string;
  dromSlug: string;
  logoSlug?: string;
  aliases?: string[];
};

// Список иностранных марок синхронизирован с загруженной библиотекой Drom.
// Российские марки и локальные российские ребрендинги намеренно не включены.
const DROM_BRAND_NAMES = [
  "212", "Abarth", "AC", "Acura", "AITO", "Alfa Romeo", "Alpina", "AMC", "Aro", "Asia",
  "Aston Martin", "Audi", "Avatr", "BAIC", "Baojun", "BAW", "Belgee", "Bentley", "Bestune", "BMW",
  "Borgward", "Brilliance", "Buick", "BYD", "Cadillac", "Changfeng", "Changhe", "Changan", "Chery", "Chevrolet",
  "Chrysler", "Citroen", "Coda", "Cupra", "Dacia", "Dadi", "Daewoo", "Daihatsu", "Datsun", "Dayun",
  "Deepal", "Denza", "Dodge", "Dongfeng", "Eagle", "ESTEO", "EXEED", "FAW", "Ferrari", "Fiat", "Fisker",
  "Ford", "Forthing", "Foton", "GAC", "Geely", "Genesis", "Geo", "GMC", "Great Wall", "Hafei", "Haima",
  "Haval", "Hawtai", "HiPhi", "Honda", "Hongqi", "Hozon", "Huanghai", "Hummer", "Hyundai", "iCAR", "IM Motors",
  "Infiniti", "Iran Khodro", "Isuzu", "IVECO", "JAC", "Jaecoo", "Jaguar", "Jeep", "Jeland", "Jetour", "Jetta",
  "Jinbei", "JMC", "Kaiyi", "KGM", "Kia", "Knewstar", "Lamborghini", "Lancia", "Land Rover",
  "Landwind", "Leapmotor", "Lexus", "Li Auto", "Lifan", "Lincoln", "Livan", "Lotus", "Lucid", "Luxgen",
  "Lynk & Co", "M-Hero", "Maextro", "Maserati", "Maxus", "Maybach", "Mazda", "McLaren", "Mercedes-Benz",
  "Mercury", "MG", "MINI", "Mitsubishi", "Mitsuoka", "Morgan", "Neta", "Nio", "Nissan", "Oldsmobile",
  "OMODA", "Opel", "ORA", "Oshan", "Oting", "Peugeot", "Plymouth", "Polar Stone", "Polestar", "Pontiac",
  "Porsche", "Proton", "RAM", "Ravon", "Renault", "Renault Samsung", "Rising Auto", "Rivian", "Roewe",
  "Rolls-Royce", "Rover", "Rox", "Saab", "SAIPA", "Saturn", "Scion", "SEAT", "Seres", "Shuanghuan", "Skoda",
  "Skywell", "Smart", "Soueast", "SsangYong", "Subaru", "Suzuki", "SWM", "Tank", "TATA",
  "Tesla", "Tianma", "Tianye", "Toyota", "Trabant", "Umo", "Vauxhall", "Venucia", "VGV", "Volkswagen",
  "Volvo", "Voyah", "Wartburg", "Weltmeister", "WEY", "Willys", "Wuling", "Xiaomi", "Xin Kai", "XPeng", "Yema",
  "Zeekr", "Zotye", "ZX",
] as const;

const SLUG_OVERRIDES: Record<string, string> = {
  "212": "212",
  "AC": "ac",
  "AITO": "aito",
  "Alfa Romeo": "alfa-romeo",
  "Aston Martin": "aston-martin",
  "BAIC": "baic",
  "BMW": "bmw",
  "BYD": "byd",
  "DeLorean": "delorean",
  "EXEED": "exeed",
  "FAW": "faw",
  "GAC": "gac",
  "GMC": "gmc",
  "Great Wall": "great-wall",
  "iCAR": "icar",
  "IM Motors": "im-motors",
  "Iran Khodro": "iran-khodro",
  "IVECO": "iveco",
  "JAC": "jac",
  "JMC": "jmc",
  "JMEV": "jmev",
  "KGM": "kgm",
  "Land Rover": "land-rover",
  "Li Auto": "li-auto",
  "Lynk & Co": "lynk-and-co",
  "M-Hero": "m-hero",
  "Mercedes-Benz": "mercedes-benz",
  "MG": "mg",
  "MINI": "mini",
  "OMODA": "omoda",
  "ORA": "ora",
  "Polar Stone": "polar-stone",
  "RAM": "ram",
  "Renault Samsung": "renault-samsung",
  "Rising Auto": "rising-auto",
  "Rolls-Royce": "rolls-royce",
  "SAIPA": "saipa",
  "SEAT": "seat",
  "SRM Shineray": "srm-shineray",
  "SWM": "swm",
  "TATA": "tata",
  "VGV": "vgv",
  "WEY": "wey",
  "XPeng": "xpeng",
  "ZX": "zx",
};

const DROM_SLUG_OVERRIDES: Record<string, string> = {
  "Li Auto": "li",
  "Lynk & Co": "lynk-and-co",
  "M-Hero": "m-hero",
  "Polar Stone": "polar-stone",
  "Renault Samsung": "renault-samsung",
  "Rising Auto": "rising-auto",
  "Rolls-Royce": "rolls-royce",
  "SRM Shineray": "srm-shineray",
};

const SIMPLE_ICON_SLUGS: Record<string, string> = {
  Acura: "acura", "Alfa Romeo": "alfaromeo", "Aston Martin": "astonmartin", Audi: "audi", Bentley: "bentley",
  BMW: "bmw", Buick: "buick", BYD: "byd", Cadillac: "cadillac", Chevrolet: "chevrolet", Chrysler: "chrysler",
  Citroen: "citroen", Cupra: "cupra", Daihatsu: "daihatsu", Dodge: "dodge", Ferrari: "ferrari", Fiat: "fiat",
  Ford: "ford", Geely: "geely", Genesis: "genesis", GMC: "gmc", Honda: "honda", Hyundai: "hyundai",
  Infiniti: "infiniti", Isuzu: "isuzu", Jaguar: "jaguar", Jeep: "jeep", Kia: "kia", Lamborghini: "lamborghini",
  "Land Rover": "landrover", Lexus: "lexus", Lincoln: "lincoln", Lotus: "lotus", "Lynk & Co": "lynkandco",
  Maserati: "maserati", Mazda: "mazda", McLaren: "mclaren", "Mercedes-Benz": "mercedes", MG: "mg", MINI: "mini",
  Mitsubishi: "mitsubishi", Nio: "nio", Nissan: "nissan", Opel: "opel", Peugeot: "peugeot", Polestar: "polestar",
  Porsche: "porsche", RAM: "ram", Renault: "renault", "Rolls-Royce": "rollsroyce", SEAT: "seat", Skoda: "skoda",
  Smart: "smart", Subaru: "subaru", Suzuki: "suzuki", Tesla: "tesla", Toyota: "toyota", Volkswagen: "volkswagen",
  Volvo: "volvo", XPeng: "xpeng",
};

function slugify(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function key(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

export const CATALOG_BRANDS: CatalogBrand[] = DROM_BRAND_NAMES
  .map((name) => {
    const slug = SLUG_OVERRIDES[name] || slugify(name);
    return {
      name,
      slug,
      dromSlug: DROM_SLUG_OVERRIDES[name] || slug,
      logoSlug: SIMPLE_ICON_SLUGS[name] || undefined,
    };
  })
  .sort((left, right) => left.name.localeCompare(right.name, "en"));

const LOCALIZED_ALIASES: Record<string, string> = {
  "기아": "Kia",
  "현대": "Hyundai",
  "쉐보레(GM대우)": "Chevrolet",
  "제네시스": "Genesis",
  "르노코리아(삼성)": "Renault Samsung",
  "르노코리아": "Renault Samsung",
  "르노삼성": "Renault Samsung",
  "한국GM": "Chevrolet",
  "벤츠": "Mercedes-Benz",
  "미니": "MINI",
  "아우디": "Audi",
  "폭스바겐": "Volkswagen",
  "KG모빌리티(쌍용)": "KGM",
  "KG모빌리티": "KGM",
  "랜드로버": "Land Rover",
  "지프": "Jeep",
  "볼보": "Volvo",
  "푸조": "Peugeot",
  "혼다": "Honda",
  "포르쉐": "Porsche",
  "캐딜락": "Cadillac",
  "크라이슬러": "Chrysler",
  "포드": "Ford",
  "재규어": "Jaguar",
  "닛산": "Nissan",
  "스바루": "Subaru",
  "미쓰비시": "Mitsubishi",
  "스즈키": "Suzuki",
  "도요타": "Toyota",
  "렉서스": "Lexus",
  "링컨": "Lincoln",
  "마세라티": "Maserati",
  "닷지": "Dodge",
  "람보르기니": "Lamborghini",
  "로터스": "Lotus",
  "롤스로이스": "Rolls-Royce",
  "맥라렌": "McLaren",
  "벤틀리": "Bentley",
  "시트로엥": "Citroen",
  "신위안": "SRM Shineray",
  "지리": "Geely",
  "페라리": "Ferrari",
  "폴스타": "Polestar",
};

const ALIASES: Record<string, string> = {
  audichina: "Audi",
  audiag: "Audi",
  audiaudi: "Audi",
  aitowenjie: "AITO",
  wenjie: "AITO",
  besturn: "Bestune",
  bawbeijingautomobileworks: "BAW",
  beijingautomobileworks: "BAW",
  baicorv: "BAIC",
  changannevo: "Changan",
  changanqiyuan: "Changan",
  changanoshan: "Changan",
  oshan: "Changan",
  cheryfengyun: "Chery",
  cheryfulwin: "Chery",
  dongfengaelous: "Dongfeng",
  dongfengaeolus: "Dongfeng",
  dongfengepi: "Dongfeng",
  dongfenge: "Dongfeng",
  dongfengfengdu: "Dongfeng",
  dongfengfengxing: "Dongfeng",
  dongfengnammi: "Dongfeng",
  dongfengyipai: "Dongfeng",
  drautomobiles: "DR",
  dsautomobiles: "DS",
  fangchengbao: "Fang Cheng Bao",
  gacaion: "AION",
  gachaobo: "HYPTEC",
  gactrumpchi: "GAC",
  geelygeometry: "Geely",
  geelygalaxy: "Geely",
  ineosgrenadier: "INEOS",
  jacmotors: "JAC",
  jacrefine: "JAC",
  jacyiwei: "JAC",
  jetourshanhai: "Jetour",
  kgmkgm: "KGM",
  lotuscars: "Lotus",
  renaultkorea: "Renault",
  renaultsamsung: "Renault",
  voyahauto: "Voyah",
  wulingmotors: "Wuling",
  xiaomiauto: "Xiaomi",
  yashengauto: "Yasheng",
  ds: "DS",
  mercedes: "Mercedes-Benz",
  mercedesbenz: "Mercedes-Benz",
  landrover: "Land Rover",
  rollsroyce: "Rolls-Royce",
  greatwall: "Great Wall",
  gwm: "Great Wall",
  liauto: "Li Auto",
  li: "Li Auto",
  lixiang: "Li Auto",
  lixiangauto: "Li Auto",
  lynkco: "Lynk & Co",
  lynkandco: "Lynk & Co",
  kgmobility: "KGM",
  ssangyong: "SsangYong",
  citroen: "Citroen",
  skoda: "Skoda",
  nio: "Nio",
  xpeng: "XPeng",
  mini: "MINI",
  seat: "SEAT",
  ram: "RAM",
  faw: "FAW",
  jac: "JAC",
  jmc: "JMC",
  mg: "MG",
  omoda: "OMODA",
  ora: "ORA",
  mhero: "M-Hero",
  polarstone: "Polar Stone",
  risingauto: "Rising Auto",
};

const byKey = new Map<string, CatalogBrand>();
for (const brand of CATALOG_BRANDS) {
  byKey.set(key(brand.name), brand);
  byKey.set(key(brand.slug), brand);
  byKey.set(key(brand.dromSlug), brand);
}

export function canonicalCatalogBrand(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  const localizedAlias = LOCALIZED_ALIASES[cleaned];
  const alias = localizedAlias || ALIASES[key(cleaned)];
  return alias || byKey.get(key(cleaned))?.name || cleaned;
}

export function catalogBrandSlug(value: string) {
  const canonical = canonicalCatalogBrand(value);
  return byKey.get(key(canonical))?.slug || slugify(canonical);
}

export function catalogBrandBySlug(slug: string) {
  return byKey.get(key(canonicalCatalogBrand(slug)));
}

export function catalogBrandLogoSlug(value: string) {
  return byKey.get(key(canonicalCatalogBrand(value)))?.logoSlug || "";
}

export function catalogBrandDromSlug(value: string) {
  return byKey.get(key(canonicalCatalogBrand(value)))?.dromSlug || catalogBrandSlug(value);
}
