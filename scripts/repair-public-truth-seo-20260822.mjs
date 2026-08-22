import fs from "node:fs/promises";

async function read(file) { return fs.readFile(file, "utf8"); }
async function write(file, value) { await fs.writeFile(file, value); }
function replaceOnce(text, from, to, label) {
  const index = text.indexOf(from);
  if (index < 0) throw new Error(`repair_marker_missing:${label}`);
  if (text.indexOf(from, index + from.length) >= 0) throw new Error(`repair_marker_ambiguous:${label}`);
  return text.slice(0, index) + to + text.slice(index + from.length);
}

// 1) Shared normalization must fail closed on gross marketplace horsepower lies.
const normalizationPath = "apps/web/lib/catalog/spec-normalization.ts";
let normalization = await read(normalizationPath);
if (!normalization.includes('from "./power-sanity"')) {
  normalization = replaceOnce(
    normalization,
    'import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";\n',
    'import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";\nimport { catalogPowerSanity } from "./power-sanity";\n',
    "normalization_power_sanity_import",
  );
}
const oldPowerBlock = `  const suppliedPowerHp = reasonable(offer.powerHp, 20, 2_500);\n  const rejectNumericModelPower = suspiciousMashinaNumericModelPower(offer, suppliedPowerHp);\n  const powerHp = rejectNumericModelPower\n    ? inferPowerHp(primary) || inferPowerHp(full)\n    : suppliedPowerHp || structuredPowerHp(offer) || inferPowerHp(primary) || inferPowerHp(full);\n  const explicitPowerKw = rejectNumericModelPower ? undefined : reasonable(offer.powerKw, 10, 2_000);\n  const powerKw = explicitPowerKw || (powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined);`;
const newPowerBlock = `  const suppliedPowerHp = reasonable(offer.powerHp, 20, 2_500);\n  const rejectNumericModelPower = suspiciousMashinaNumericModelPower(offer, suppliedPowerHp);\n  const candidatePowerHp = rejectNumericModelPower\n    ? inferPowerHp(primary) || inferPowerHp(full)\n    : suppliedPowerHp || structuredPowerHp(offer) || inferPowerHp(primary) || inferPowerHp(full);\n  const powerSanity = catalogPowerSanity({ ...offer, engineCc }, candidatePowerHp);\n  const powerHp = powerSanity.suspicious ? undefined : candidatePowerHp;\n  // If horsepower was rejected, do not retain a previously derived kW value\n  // from the same bad marketplace number. Verified V2/official knowledge may\n  // repopulate both fields after this normalization pass.\n  const explicitPowerKw = rejectNumericModelPower || powerSanity.suspicious ? undefined : reasonable(offer.powerKw, 10, 2_000);\n  const powerKw = explicitPowerKw || (powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined);`;
if (normalization.includes(oldPowerBlock)) normalization = replaceOnce(normalization, oldPowerBlock, newPowerBlock, "normalization_power_block");
else if (!normalization.includes("const powerSanity = catalogPowerSanity")) throw new Error("repair_marker_missing:normalization_power_block");
const returnMarker = `  return {\n    ...offer,\n    sourceCurrency: normalizedCurrency(offer),`;
const returnReplacement = `  return {\n    ...offer,\n    operational: powerSanity.suspicious ? {\n      ...(offer.operational || {}),\n      powerSanity: { rejected: true, reason: powerSanity.reason, rejectedPowerHp: candidatePowerHp || null },\n    } : offer.operational,\n    sourceCurrency: normalizedCurrency(offer),`;
if (normalization.includes(returnMarker)) normalization = replaceOnce(normalization, returnMarker, returnReplacement, "normalization_power_audit");
else if (!normalization.includes("rejectedPowerHp")) throw new Error("repair_marker_missing:normalization_power_audit");
await write(normalizationPath, normalization);

// 2) DubiCars: parse the WHOLE thousands-separated token. Never turn 1,997 into 997.
for (const sourcePath of ["apps/web/lib/catalog/dubicars-current-source.ts", "apps/web/lib/catalog/dubicars-exact-source.ts"]) {
  let source = await read(sourcePath);
  if (!source.includes('from "./power-sanity"')) {
    source = replaceOnce(
      source,
      'import { normalizeVehicleOfferSpecs } from "./spec-normalization";\n',
      'import { normalizeVehicleOfferSpecs } from "./spec-normalization";\nimport { parseCatalogHorsepowerToken } from "./power-sanity";\n',
      `${sourcePath}:power_import`,
    );
  }
  if (sourcePath.endsWith("dubicars-current-source.ts")) {
    const old = `  const parsedPowerHp = integer(\n    fullPlain.match(/Horsepower\\s*[:：]?\\s*([0-9]{2,4})\\s*(?:HP|PS|BHP)?\\b/i)?.[1]\n    || fullPlain.match(/\\b([0-9]{2,4})\\s*(?:HP|PS|BHP)\\b/i)?.[1]\n    || title.match(/\\b([0-9]{2,4})\\s*HP\\b/i)?.[1],\n  );\n  const powerHp = parsedPowerHp && parsedPowerHp <= 1_500 ? parsedPowerHp : undefined;`;
    const next = `  const sourcePowerText = labelValue(fullPlain, ["Horsepower"], stops)\n    || fullPlain.match(/Horsepower\\s*[:：]?\\s*[0-9][0-9, .]*\\s*(?:HP|PS|BHP)\\b/i)?.[0]\n    || title.match(/\\b[0-9][0-9, .]*\\s*(?:HP|PS|BHP)\\b/i)?.[0]\n    || "";\n  const parsedPowerHp = parseCatalogHorsepowerToken(sourcePowerText);\n  // A marketplace can contain a typo such as 1,997 HP. Preserve the source\n  // page as provenance, but never publish an extreme unverified label as fact.\n  const powerHp = parsedPowerHp && parsedPowerHp <= 1_500 ? parsedPowerHp : undefined;`;
    if (source.includes(old)) source = replaceOnce(source, old, next, "dubicars_current_power_parse");
    else if (!source.includes("sourcePowerText")) throw new Error("repair_marker_missing:dubicars_current_power_parse");
  } else {
    const old = `  const powerHp = num(plain.match(/(?:Horsepower)?\\s*([0-9]{2,4})\\s*HP\\b/i)?.[1]);`;
    const next = `  const sourcePowerText = plain.match(/Horsepower\\s*[:：]?\\s*[0-9][0-9, .]*\\s*(?:HP|PS|BHP)\\b/i)?.[0] || "";\n  const parsedPowerHp = parseCatalogHorsepowerToken(sourcePowerText);\n  const powerHp = parsedPowerHp && parsedPowerHp <= 1_500 ? parsedPowerHp : undefined;`;
    if (source.includes(old)) source = replaceOnce(source, old, next, "dubicars_exact_power_parse");
    else if (!source.includes("const sourcePowerText = plain.match(/Horsepower")) throw new Error("repair_marker_missing:dubicars_exact_power_parse");
  }
  await write(sourcePath, source);
}

// 3) Do not put meaningless marketplace Trim=Other into public titles.
const presentationPath = "apps/web/lib/catalog/presentation.ts";
let presentation = await read(presentationPath);
const trimMarker = `  let trim = china ? "" : collapseAdjacentRepeatedPhrases(publicTitleTrim(offer?.trim));\n  trim = removeLeadingPhrase(trim, base);`;
const trimReplacement = `  let trim = china ? "" : collapseAdjacentRepeatedPhrases(publicTitleTrim(offer?.trim));\n  if (/^(?:other|другое|прочее|прочий|unknown|n\\/?a)$/i.test(trim)) trim = "";\n  trim = removeLeadingPhrase(trim, base);`;
if (presentation.includes(trimMarker)) presentation = replaceOnce(presentation, trimMarker, trimReplacement, "presentation_generic_trim");
else if (!presentation.includes("другое|прочее|прочий")) throw new Error("repair_marker_missing:presentation_generic_trim");
await write(presentationPath, presentation);

// 4) Offer page: visible SSR facts for users and crawlers + display-level power guard.
const pagePath = "apps/web/app/(public)/cars/offer/[id]/page.tsx";
let page = await read(pagePath);
if (!page.includes('from "@/lib/catalog/power-sanity"')) {
  page = replaceOnce(
    page,
    'import { catalogPowerDisplay } from "@/lib/catalog/power-display";\n',
    'import { catalogPowerDisplay } from "@/lib/catalog/power-display";\nimport { publicCatalogPowerHp } from "@/lib/catalog/power-sanity";\n',
    "offer_page_power_import",
  );
}
const powerDisplayMarker = `  const powerDisplay = catalogPowerDisplay(raw);`;
if (!page.includes("const safePowerHp = publicCatalogPowerHp(raw);")) {
  page = replaceOnce(page, powerDisplayMarker, `${powerDisplayMarker}\n  const safePowerHp = publicCatalogPowerHp(raw);`, "offer_page_safe_power");
}
const oldPowerValue = `  const powerValue = electrified\n    ? o.powerKw ? \`${"${o.powerKw}"} кВт\` : o.powerHp ? \`${"${o.powerHp}"} л.с.\` : ""\n    : o.powerHp ? \`${"${o.powerHp}"} л.с.\` : o.powerKw ? \`${"${o.powerKw}"} кВт\` : "";`;
const newPowerValue = `  const powerValue = electrified\n    ? o.powerKw ? \`${"${o.powerKw}"} кВт\` : safePowerHp ? \`${"${safePowerHp}"} л.с.\` : ""\n    : safePowerHp ? \`${"${safePowerHp}"} л.с.\` : o.powerKw ? \`${"${o.powerKw}"} кВт\` : "";`;
if (page.includes(oldPowerValue)) page = replaceOnce(page, oldPowerValue, newPowerValue, "offer_page_power_value");
else if (!page.includes("safePowerHp ? `${safePowerHp} л.с.`")) throw new Error("repair_marker_missing:offer_page_power_value");

const specsEnd = `  ]).filter(Boolean) as SpecItem[];\n\n  return <main`;
const factsBlock = `  ]).filter(Boolean) as SpecItem[];\n\n  const readableTrim = knownValue(o.trimLabel);\n  const publicTrim = /^(?:other|другое|прочее|прочий|unknown|n\\/?a)$/i.test(readableTrim) ? "" : readableTrim;\n  const readableFacts = [\n    ["Марка", knownValue(o.makeLabel)],\n    ["Модель", knownValue(o.modelLabel)],\n    ["Комплектация", publicTrim],\n    ["Год выпуска", o.year ? \`${"${o.year}"}\` : ""],\n    ["Пробег", mileageKm > 0 ? \`${"${money(mileageKm)}"} км\` : ""],\n    ["Объём двигателя", Number(o.engineCc || 0) > 0 ? \`${"${money(o.engineCc)}"} см³\` : ""],\n    ["Топливо", fuelValue],\n    ["Мощность", safePowerHp ? \`${"${safePowerHp}"} л.с.\` : ""],\n    ["Коробка передач", transmissionValue],\n    ["Привод", driveLabel],\n    ["Кузов", bodyValue],\n    ["Рынок", knownValue(o.marketLabel)],\n  ].filter((item) => item[1]) as Array<[string, string]>;\n  const factualSummary = [\n    \`${"${knownValue(o.makeLabel)} ${knownValue(o.modelLabel)}"}\`.trim(),\n    o.year ? \`${"${o.year}"} года\` : "",\n    Number(o.engineCc || 0) > 0 ? \`двигатель ${"${(Number(o.engineCc) / 1000).toFixed(Number(o.engineCc) % 1000 ? 1 : 0)}"} л\` : "",\n    fuelValue ? \`топливо — ${"${fuelValue.toLowerCase()}"}\` : "",\n    driveLabel ? \`${"${driveLabel.toLowerCase()}"}\` : "",\n    transmissionValue ? \`коробка — ${"${transmissionValue.toLowerCase()}"}\` : "",\n  ].filter(Boolean).join(", ");\n\n  return <main`;
if (page.includes(specsEnd)) page = replaceOnce(page, specsEnd, factsBlock, "offer_page_readable_facts");
else if (!page.includes("const readableFacts = [")) throw new Error("repair_marker_missing:offer_page_readable_facts");

const similarMarker = `      <Suspense fallback={<SimilarOffersFallback />}><SimilarOffers current={raw} /></Suspense>`;
const readableSection = `      <section aria-labelledby="vehicle-facts-heading" className="mt-10 rounded-[1.7rem] bg-[var(--ac-surface-2)] p-5 md:mt-14 md:p-7">\n        <h2 id="vehicle-facts-heading" className="text-2xl font-black tracking-[-0.03em] md:text-3xl">Характеристики {o.makeLabel} {o.modelLabel}</h2>\n        {factualSummary ? <p className="mt-3 max-w-5xl text-sm font-semibold leading-6 text-[var(--ac-muted)] md:text-base">{factualSummary}. Данные нормализованы АвтоЦеной по карточке источника и проверенной базе знаний; сомнительные характеристики не публикуются как факт.</p> : null}\n        <dl className="mt-6 grid gap-x-8 gap-y-0 md:grid-cols-2">\n          {readableFacts.map(([label, value]) => <div key={label} className="flex min-w-0 items-start justify-between gap-5 border-b border-white/10 py-3 text-sm md:text-base"><dt className="text-[var(--ac-muted)]">{label}</dt><dd className="min-w-0 text-right font-bold text-[var(--ac-text)]">{value}</dd></div>)}\n        </dl>\n        {sourceUrl ? <p className="mt-5 text-xs font-semibold text-[var(--ac-muted)]">Исходное объявление: <a href={sourceUrl} target="_blank" rel="nofollow noopener noreferrer" className="underline underline-offset-4">проверить у продавца</a>. АвтоЦена не копирует рекламное описание продавца и показывает только нормализованные факты.</p> : null}\n      </section>\n\n      ${similarMarker}`;
if (page.includes(similarMarker) && !page.includes('id="vehicle-facts-heading"')) page = replaceOnce(page, similarMarker, readableSection, "offer_page_readable_section");
else if (!page.includes('id="vehicle-facts-heading"')) throw new Error("repair_marker_missing:offer_page_readable_section");
await write(pagePath, page);

// 5) JSON-LD: structured facts use the same safe power contract.
const layoutPath = "apps/web/app/(public)/cars/offer/[id]/layout.tsx";
let layout = await read(layoutPath);
if (!layout.includes('from "@/lib/catalog/power-sanity"')) {
  layout = replaceOnce(
    layout,
    'import { getOfferForPage } from "@/lib/catalog/offer-page-data";\n',
    'import { getOfferForPage } from "@/lib/catalog/offer-page-data";\nimport { publicCatalogPowerHp } from "@/lib/catalog/power-sanity";\n',
    "offer_layout_power_import",
  );
}
const mileageMarker = `  const mileageKm = Number(offer.mileageKm || 0);`;
if (!layout.includes("const safePowerHp = publicCatalogPowerHp(offer);")) {
  layout = replaceOnce(layout, mileageMarker, `${mileageMarker}\n  const engineCc = Number(offer.engineCc || 0);\n  const safePowerHp = publicCatalogPowerHp(offer);`, "offer_layout_safe_power");
}
const transmissionMarker = `    vehicleTransmission: clean(offer.transmission) || undefined,`;
const structuredExtra = `    vehicleTransmission: clean(offer.transmission) || undefined,\n    bodyType: clean(offer.bodyType) || undefined,\n    driveWheelConfiguration: clean(offer.drive) || undefined,\n    vehicleEngine: engineCc > 0 || safePowerHp ? {\n      "@type": "EngineSpecification",\n      engineDisplacement: engineCc > 0 ? { "@type": "QuantitativeValue", value: Math.round(engineCc), unitCode: "CMQ" } : undefined,\n      enginePower: safePowerHp ? { "@type": "QuantitativeValue", value: safePowerHp, unitText: "hp" } : undefined,\n    } : undefined,`;
if (layout.includes(transmissionMarker) && !layout.includes("driveWheelConfiguration")) layout = replaceOnce(layout, transmissionMarker, structuredExtra, "offer_layout_structured_specs");
else if (!layout.includes("driveWheelConfiguration")) throw new Error("repair_marker_missing:offer_layout_structured_specs");
await write(layoutPath, layout);

// 6) Update structural test to the intentionally resilient memoized loader.
const navTestPath = "tests/offer-navigation-performance.test.ts";
let navTest = await read(navTestPath);
const oldMemoAssertion = `  assert.match(data, /cache\\(\\(id: string\\) => getOfferAcrossRequests\\(id\\)\\)/);`;
const newMemoAssertions = `  assert.match(data, /async function resilientOfferLookup/);\n  assert.match(data, /return getOffer\\(id\\)/);\n  assert.match(data, /cache\\(\\(id: string\\) => resilientOfferLookup\\(id\\)\\)/);`;
if (navTest.includes(oldMemoAssertion)) navTest = replaceOnce(navTest, oldMemoAssertion, newMemoAssertions, "nav_resilient_lookup_test");
else if (!navTest.includes("async function resilientOfferLookup")) throw new Error("repair_marker_missing:nav_resilient_lookup_test");
await write(navTestPath, navTest);

// 7) CI explicitly owns the public truth/SEO regression.
const ciPath = ".github/workflows/ci.yml";
let ci = await read(ciPath);
const powerTestLine = `        run: node --import tsx --test tests/catalog-power-normalization.test.ts tests/catalog-knowledge-power-conflict.test.ts`;
if (ci.includes(powerTestLine) && !ci.includes("tests/catalog-public-truth-seo.test.ts")) {
  ci = replaceOnce(ci, powerTestLine, `${powerTestLine} tests/catalog-public-truth-seo.test.ts`, "ci_public_truth_test");
}
await write(ciPath, ci);

console.log("public truth and SEO repair applied");
