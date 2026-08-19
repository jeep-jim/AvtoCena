import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalogPrice = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogPrice.tsx", import.meta.url), "utf8");
const preliminaryPrice = fs.readFileSync(new URL("../apps/web/components/catalog/PreliminaryPrice.tsx", import.meta.url), "utf8");
const priceTrend = fs.readFileSync(new URL("../apps/web/components/catalog/PriceTrend.tsx", import.meta.url), "utf8");
const carsLoading = fs.readFileSync(new URL("../apps/web/app/(public)/cars/loading.tsx", import.meta.url), "utf8");
const carsLayout = fs.readFileSync(new URL("../apps/web/app/(public)/cars/layout.tsx", import.meta.url), "utf8");
const catalogFilters = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx", import.meta.url), "utf8");
const offerPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const priceSheetCss = fs.readFileSync(new URL("../apps/web/app/public-price-sheet-fix.css", import.meta.url), "utf8");

test("catalog price colors distinguish electrified, preliminary and regular calculations", () => {
  assert.match(catalogPrice, /highlightElectrified/);
  assert.match(catalogPrice, /electric.*series_hybrid.*other_hybrid/);
  assert.match(catalogPrice, /hybrid\|phev\|hev\|mhev/);
  assert.match(catalogPrice, /PreliminaryPrice[^;]+highlightElectrified=\{highlightElectrified\}/s);
  assert.match(catalogPrice, /PriceTrend[^;]+highlightElectrified=\{highlightElectrified\}/s);
  assert.match(preliminaryPrice, /highlightElectrified \? \(lightTheme \? "#c58a00" : "#ffd21f"\) : "var\(--ac-text\)"/);
  assert.match(priceTrend, /highlightElectrified \? \(lightTheme \? "#c58a00" : "#ffd21f"\) : undefined/);
  assert.match(priceTrend, /style=\{priceColor \? \{ color: priceColor \} : undefined\}/);
  assert.match(priceTrend, /ac-price--electrified/);
  assert.match(preliminaryPrice, /ac-price--electrified/);
  assert.match(priceSheetCss, /\.ac-price\.ac-price--electrified[^}]+#ffd21f !important/s);
  assert.match(priceSheetCss, /html\[data-theme="light"\][^}]+\.ac-price\.ac-price--electrified[^}]+#c58a00 !important/s);
  assert.match(preliminaryPrice, /Почему цена предварительная/);
  assert.match(offerPage, /PreliminaryPrice[^;]+highlightElectrified=\{electrified\}/s);
  assert.match(offerPage, /PriceTrend[^;]+highlightElectrified=\{electrified\}/s);
  assert.match(preliminaryPrice, /rgba\(197, 138, 0, 0\.10\)/);
  assert.match(preliminaryPrice, /rgba\(255, 210, 31, 0\.14\)/);
  assert.match(preliminaryPrice, /: "var\(--ac-surface-2\)"/);
  assert.match(priceTrend, /if \(highlightElectrified\)/);
  assert.match(priceTrend, /rgba\(197, 138, 0, 0\.10\)/);
  assert.match(priceTrend, /rgba\(255, 210, 31, 0\.14\)/);
  assert.match(priceTrend, /\[panel, lightTheme, direction, highlightElectrified\]/);
  assert.match(preliminaryPrice, /setProperty\("background", electrifiedPanelBackground, "important"\)/);
  assert.match(preliminaryPrice, /setProperty\("background-color", electrifiedPanelBackground, "important"\)/);
  assert.match(offerPage, /height:auto!important;aspect-ratio:4\/3!important/);
});

test("Japanese auction results use a neutral historical price and auction gavel", () => {
  assert.match(catalogPrice, /japanAuction/);
  assert.match(catalogPrice, /AuctionResultPrice/);
  assert.match(priceTrend, /function AuctionGavelIcon/);
  assert.match(priceTrend, /import \{ Gavel \} from "lucide-react"/);
  assert.match(priceTrend, /bg-\[#ef3340\]/);
  assert.match(priceTrend, /Завершённый аукционный лот/);
  assert.match(priceTrend, /Текущий курс её не изменяет/);
  assert.match(offerPage, /\{japanAuction/);
  assert.match(offerPage, /<AuctionResultPrice offer=\{o\} label="Завершённый аукцион"/);
  assert.match(offerPage, /html\[data-theme="light"\][^}]+\.ac-offer-price-panel[^}]+background:#fff!important/s);
});

test("saved total changes are not mislabeled as currency impact", () => {
  assert.match(priceTrend, /trendUsesCurrency/);
  assert.match(priceTrend, /const currencyImpactRub = currencyDelta\(pricedOffer\) \|\| undefined/);
  assert.match(priceTrend, /const canShowRate = Boolean\(sheetRate && trend\)/);
  assert.match(priceTrend, /trendUsesCurrency \? "Показать влияние курса валюты" : "Показать курс валюты и полный расчёт"/);
  assert.match(priceTrend, /impactRub=\{currencyImpactRub\}/);
  assert.match(priceTrend, /Стрелка показывает изменение полного сохранённого расчёта\. Влияние курса указано отдельно\./);
});

test("catalog route loader follows active light or dark theme variables", () => {
  assert.match(carsLoading, /bg-\[var\(--ac-surface\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-text\)\]/);
  assert.match(carsLoading, /text-\[var\(--ac-muted\)\]/);
  assert.match(carsLoading, /bg-\[var\(--ac-surface-3\)\]/);
  assert.doesNotMatch(carsLoading, /bg-\[#0f172a\]|text-white|bg-white\/\[/);
});

test("catalog filter changes have one client navigation owner", () => {
  assert.match(catalogFilters, /router\.replace/);
  assert.doesNotMatch(carsLayout, /CatalogFilterAutoApply/);
});
