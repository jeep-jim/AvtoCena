from pathlib import Path
p=Path('apps/web/lib/catalog/presentation.ts')
s=p.read_text()
if not s.startswith('const directPhrases'):
    raise SystemExit('unexpected presentation header')
s='import { CATALOG_BRANDS } from "./brands";\n\n'+s
anchor='  [/特斯拉/g, "Tesla "],\n'
insert='''  [/特斯拉/g, "Tesla "],
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
'''
if anchor not in s: raise SystemExit('Tesla mapping anchor missing')
s=s.replace(anchor,insert,1)
old='''function publicChinaMake(offer: any) {
  const translated = compactListingText(offer?.make);
  const cleaned = stripUnresolvedHan(translated);
  return cleaned || "Марка уточняется";
}
'''
new='''const catalogBrandsByLength = [...CATALOG_BRANDS]
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
  const translated = compactListingText(offer?.make);
  const cleaned = stripUnresolvedHan(translated);
  if (cleaned) return cleaned;

  // AutoHome occasionally stores an empty/unmapped manufacturer field while
  // the exact listing/model title still contains a known Latin manufacturer.
  // Recover only a catalog-known brand from source-bound text; never guess.
  for (const candidate of [offer?.sourceTitle, offer?.model, offer?.operational?.sourceTitle]) {
    const brand = knownCatalogBrandInText(candidate);
    if (brand) return brand;
  }

  // A missing public brand must not become the literal card title
  // "Марка уточняется ...". The factual model remains visible by itself.
  return "";
}
'''
if old not in s: raise SystemExit('publicChinaMake block missing')
s=s.replace(old,new,1)
p.write_text(s)

t=Path('tests/catalog-preview-presentation-20260812.test.ts')
t.write_text('''import assert from "node:assert/strict";\nimport test from "node:test";\nimport { catalogOfferTitle, presentCatalogOffer } from "../apps/web/lib/catalog/presentation";\n\ntest("China title recovers a known brand from exact source text when make is unavailable", () => {\n  const offer = { market: "china", make: "未知厂商", model: "福特Ranger", sourceTitle: "福特Ranger 2025款 2.3T", year: 2025 };\n  assert.equal(catalogOfferTitle(offer), "Ford Ranger");\n});\n\ntest("China title translates newly mapped source manufacturer instead of saying make pending", () => {\n  const offer = { market: "china", make: "威麟", model: "威麟R08", sourceTitle: "威麟R08 2025款 2.3T", year: 2025 };\n  assert.equal(catalogOfferTitle(offer), "Rely R08");\n});\n\ntest("China title omits an actually unresolved make rather than publishing placeholder copy", () => {\n  const offer = { market: "china", make: "未知厂商", model: "未知R99", sourceTitle: "未知R99 2025款", year: 2025 };\n  const presented = presentCatalogOffer(offer);\n  assert.equal(presented.title, "R99");\n  assert.doesNotMatch(presented.title, /Марка уточняется|Модель уточняется/);\n});\n''')
