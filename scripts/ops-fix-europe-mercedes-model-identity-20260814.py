from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected 1 match, got {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


normalizer = Path("apps/web/lib/catalog/open-source-normalizer.ts")
text = normalizer.read_text(encoding="utf-8")
anchor = '''export function canonicalOpenModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const title = removeLeadingMake(withoutLeadingYear(clean(titleInput)), make);'''
helper = r'''const MERCEDES_CLASS_BY_LETTER: Record<string, string> = {
  A: "A-Class", B: "B-Class", C: "C-Class", E: "E-Class", G: "G-Class", S: "S-Class", V: "V-Class",
};
const MERCEDES_CODE_MODELS: Record<string, string> = {
  GLA: "GLA Class", GLB: "GLB Class", GLC: "GLC Class", GLE: "GLE Class", GLS: "GLS Class",
  CLA: "CLA", CLS: "CLS", EQA: "EQA", EQB: "EQB", EQC: "EQC", EQE: "EQE", EQS: "EQS", EQV: "EQV",
  VITO: "Vito", SPRINTER: "Sprinter", CITAN: "Citan", SL: "SL", SLC: "SLC", SLK: "SLK",
};

function canonicalMercedesModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const fallback = clean(fallbackModel);
  let title = withoutLeadingYear(clean(titleInput)).replace(/[‐‑‒–—]/g, "-");
  const mercedesContext = /mercedes|benz/i.test(make)
    || /^(?:mercedes(?:[-\s]+benz)?|benz)\b/i.test(title)
    || /^(?:benz|mercedes(?:-benz)?)$/i.test(fallback);
  if (!mercedesContext) return "";

  title = title
    .replace(/^mercedes(?:[-\s]+benz)?\s+/i, "")
    .replace(/^benz\s+/i, "")
    .trim();

  let match = title.match(/^(?:class|klasse|klasa|classe|clase)\s*([ABCEGSV])\b/i)
    || title.match(/^([ABCEGSV])[-\s]?(?:class|klasse|klasa|classe|clase)\b/i);
  if (match?.[1]) return MERCEDES_CLASS_BY_LETTER[match[1].toUpperCase()] || "";

  match = title.match(/^(GLA|GLB|GLC|GLE|GLS|CLA|CLS|EQA|EQB|EQC|EQE|EQS|EQV|VITO|SPRINTER|CITAN|SLC|SLK|SL)\b/i);
  if (match?.[1]) return MERCEDES_CODE_MODELS[match[1].toUpperCase()] || "";

  match = title.match(/^(AMG\s+(?:GT|SL))\b/i);
  if (match?.[1]) return match[1].toUpperCase().replace(/\s+/g, " ");
  if (/^Marco\s+Polo\b/i.test(title)) return "Marco Polo";

  match = title.match(/^([ABCEGSV])\s+(?=\d{2,3}\b)/i);
  if (match?.[1]) return MERCEDES_CLASS_BY_LETTER[match[1].toUpperCase()] || "";

  return "";
}

export function canonicalSourceModelIdentity(titleInput: string, makeInput: string, fallbackModel = "") {
  return canonicalMercedesModel(titleInput, makeInput, fallbackModel) || clean(fallbackModel);
}

export function canonicalOpenModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const rawTitle = withoutLeadingYear(clean(titleInput));
  const sourceIdentity = canonicalMercedesModel(rawTitle, make, fallbackModel);
  if (sourceIdentity) return sourceIdentity;
  const title = removeLeadingMake(rawTitle, make);'''
if anchor not in text:
    raise SystemExit("open-source normalizer anchor missing")
normalizer.write_text(text.replace(anchor, helper, 1), encoding="utf-8")

autoscout = "apps/web/lib/catalog/autoscout-exact-source-base.ts"
replace_once(autoscout,
    'import { stableOfferId } from "./storage";\n',
    'import { canonicalSourceModelIdentity } from "./open-source-normalizer";\nimport { stableOfferId } from "./storage";\n')
replace_once(autoscout,
    '    const id = clean(listing.id), sourceUrl = absoluteUrl(listing.url), make = clean(listing.vehicle?.make), model = clean(listing.vehicle?.model);\n    const trim = clean(listing.vehicle?.modelVersionInput || listing.vehicle?.variant || listing.vehicle?.motorTypeName);',
    '    const id = clean(listing.id), sourceUrl = absoluteUrl(listing.url), make = clean(listing.vehicle?.make), sourceModel = clean(listing.vehicle?.model);\n    const trim = clean(listing.vehicle?.modelVersionInput || listing.vehicle?.variant || listing.vehicle?.motorTypeName);\n    const sourceTitle = clean([make, sourceModel, trim].filter(Boolean).join(" "));\n    const model = canonicalSourceModelIdentity(sourceTitle, make, sourceModel);')
replace_once(autoscout,
    '    const title = clean([make, model, trim].filter(Boolean).join(" "));',
    '    const title = sourceTitle;')

mobile = "apps/web/lib/catalog/mobile-de-exact-source.ts"
replace_once(mobile,
    'import { stableOfferId } from "./storage";\n',
    'import { canonicalSourceModelIdentity } from "./open-source-normalizer";\nimport { stableOfferId } from "./storage";\n')
replace_once(mobile, '  const model = clean(item?.model);', '  const sourceModel = clean(item?.model);')
replace_once(mobile,
    '  const title = clean(item?.title || [make, model, item?.subTitle].filter(Boolean).join(" "));\n  const trim = clean(item?.subTitle);',
    '  const title = clean(item?.title || [make, sourceModel, item?.subTitle].filter(Boolean).join(" "));\n  const model = canonicalSourceModelIdentity(title, make, sourceModel);\n  const trim = clean(item?.subTitle);')
replace_once(mobile,
    '    offer.make = clean(ad?.makeKey) || offer.make;\n    offer.model = clean(ad?.modelKey) || offer.model;\n    offer.sourceTitle = clean(ad?.title) || offer.sourceTitle;',
    '    const detailMake = clean(ad?.makeKey) || offer.make;\n    const detailTitle = clean(ad?.title) || offer.sourceTitle;\n    const detailModel = canonicalSourceModelIdentity(detailTitle, detailMake, clean(ad?.modelKey) || offer.model);\n    offer.make = detailMake;\n    offer.model = detailModel;\n    offer.sourceTitle = detailTitle;')

otomoto = "apps/web/lib/catalog/otomoto-exact-source.ts"
replace_once(otomoto,
    'import { normalizeVehicleOfferSpecs } from "./spec-normalization";\n',
    'import { canonicalSourceModelIdentity } from "./open-source-normalizer";\nimport { normalizeVehicleOfferSpecs } from "./spec-normalization";\n')
replace_once(otomoto,
    'function makeModel(title:string){const normalized=clean(title).replace(/^Używany\\s+/i,"");const lower=normalized.toLowerCase();const make=MAKES.find(x=>lower===x.toLowerCase()||lower.startsWith(`${x.toLowerCase()} `))||"";return{make,model:make?normalized.slice(make.length).trim().split(/\\s+/).slice(0,8).join(" "):""}}',
    'function makeModel(title:string){const normalized=clean(title).replace(/^Używany\\s+/i,"");const lower=normalized.toLowerCase();const make=MAKES.find(x=>lower===x.toLowerCase()||lower.startsWith(`${x.toLowerCase()} `))||"";const fallback=make?normalized.slice(make.length).trim().split(/\\s+/).slice(0,8).join(" "):"";return{make,model:canonicalSourceModelIdentity(normalized,make,fallback)}}')
replace_once(otomoto,
    'const model=clean(car.model)||mm.model||fallback?.model||"";',
    'const model=canonicalSourceModelIdentity(title,make,clean(car.model)||mm.model||fallback?.model||"");')

test_path = Path("tests/open-source-normalizer.test.ts")
test = test_path.read_text(encoding="utf-8")
test = test.replace(
    'import { canonicalOpenModel } from "../apps/web/lib/catalog/open-source-normalizer";',
    'import { canonicalOpenModel, canonicalSourceModelIdentity } from "../apps/web/lib/catalog/open-source-normalizer";',
    1,
)
test += r'''

test("repairs generic Mercedes-Benz model identity from exact source titles", () => {
  assert.equal(canonicalSourceModelIdentity("Mercedes Benz A 200 AMG Line", "Mercedes", "Benz"), "A-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz E 200 Avantgarde", "Mercedes-Benz", "Benz"), "E-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz B 200 Progressive", "Mercedes-Benz", "Benz"), "B-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Vito 114 CDI", "Mercedes-Benz", "Benz"), "Vito");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Sprinter 319 CDI", "Mercedes-Benz", "Benz"), "Sprinter");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Klasa C 200", "Mercedes-Benz", "Benz"), "C-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz GLC 300 4MATIC", "Mercedes-Benz", "Benz"), "GLC Class");
});

test("source identity repair remains fail-closed for unrelated brands and unknown Mercedes shapes", () => {
  assert.equal(canonicalSourceModelIdentity("BMW 320i M Sport", "BMW", "3 Series"), "3 Series");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Unknown Special", "Mercedes-Benz", "Benz"), "Benz");
});
'''
test_path.write_text(test, encoding="utf-8")
