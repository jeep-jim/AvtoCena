import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const catalogPrice = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogPrice.tsx", import.meta.url), "utf8");
const auctionCardPrice = fs.readFileSync(new URL("../apps/web/components/catalog/AuctionCardPrice.tsx", import.meta.url), "utf8");
const preliminaryPrice = fs.readFileSync(new URL("../apps/web/components/catalog/PreliminaryPrice.tsx", import.meta.url), "utf8");
const priceTrend = fs.readFileSync(new URL("../apps/web/components/catalog/PriceTrend.tsx", import.meta.url), "utf8");
const carsLoading = fs.readFileSync(new URL("../apps/web/app/(public)/cars/loading.tsx", import.meta.url), "utf8");
const carsLayout = fs.readFileSync(new URL("../apps/web/app/(public)/cars/layout.tsx", import.meta.url), "utf8");
const catalogFilters = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogFilters.tsx", import.meta.url), "utf8");
const offerPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const priceSheetCss = fs.readFileSync(new URL("../apps/web/app/public-price-sheet-fix.css", import.meta.url), "utf8");
const editablePower = fs.readFileSync(new URL("../apps/web/components/catalog/EditablePowerTile.tsx", import.meta.url), "utf8");
const rootLayout = fs.readFileSync(new URL("../apps/web/app/layout.tsx", import.meta.url), "utf8");

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

test("pending source-priced cards stay out of the public grid", () => {
  assert.match(catalogCard, /if \(!visibleRub\) return null/);
  assert.match(catalogCard, /totalRub:\s*visibleRub \|\| null/);
});

test("Japanese auction microcards use a neutral historical price and non-navigating plain gavel", () => {
  assert.match(catalogPrice, /japanAuction/);
  assert.match(catalogPrice, /AuctionCardPrice/);
  assert.match(auctionCardPrice, /import \{ Gavel \} from "lucide-react"/);
  assert.match(auctionCardPrice, /bg-transparent/);
  assert.doesNotMatch(auctionCardPrice, /bg-\[#ef3340\]/);
  assert.match(auctionCardPrice, /bottom-\[calc\(100%\+10px\)\]/);
  assert.match(auctionCardPrice, /Завершённый аукционный лот/);
  assert.match(auctionCardPrice, /Текущий курс её не изменяет/);
  assert.match(auctionCardPrice, /event\.preventDefault\(\)/);
  assert.match(auctionCardPrice, /event\.stopPropagation\(\)/);
  assert.match(priceSheetCss, /\.ac-auction-gavel[^}]+background:\s*transparent !important/s);
  assert.match(priceTrend, /export function AuctionResultPrice/);
  assert.match(priceTrend, /ac-offer-auction-gavel/);
  assert.doesNotMatch(priceTrend, /ac-offer-auction-gavel[^\n]+bg-\[#ef3340\]/);
  assert.doesNotMatch(priceTrend, /ac-offer-auction-gavel[^\n]+\btext-white\b/);
  assert.match(priceSheetCss, /\.ac-offer-auction-gavel[^}]+background:\s*#11151d !important[^}]+color:\s*#fff !important/s);
  assert.match(priceSheetCss, /\.ac-offer-auction-gavel > svg\s*\{[^}]+color:\s*#fff !important;[^}]+stroke:\s*#fff !important;/s);
  assert.match(offerPage, /\{japanAuction/);
  assert.match(offerPage, /<AuctionResultPrice offer=\{o\} label="Завершённый аукцион"/);
  assert.match(offerPage, /html\[data-theme="light"\][^}]+\.ac-offer-price-panel[^}]+background:#fff!important/s);
  assert.match(offerPage, /Продано на торгах[^\n]+auctionDateLabel \|\| updatedDate[^\n]+sourceUrl \? <a href=\{sourceUrl\}[^\n]+\{updatedTime\}<\/a>/);
  assert.doesNotMatch(offerPage, /Завершённый лот\{auctionDateLabel/);
});

test("catalog helper popovers preserve card rounding and currency opens only on click", () => {
  assert.match(priceSheetCss, /> a > div:first-child\s*\{[^}]+border-radius:\s*var\(--ac-card-radius\) var\(--ac-card-radius\) 0 0 !important/s);
  assert.match(priceSheetCss, /> a > div:last-child\s*\{[^}]+border-radius:\s*0 0 var\(--ac-card-radius\) var\(--ac-card-radius\) !important/s);
  assert.doesNotMatch(priceTrend, /onMouseEnter=\{\(\) => \{ if \(canShowRate && desktopHover\) setPopoverOpen\(true\); \}\}/);
  assert.doesNotMatch(priceTrend, /onMouseLeave=\{\(\) => \{ if \(desktopHover\) setPopoverOpen\(false\); \}\}/);
  assert.match(priceTrend, /if \(desktopHover\) setPopoverOpen\(\(current\) => !current\); else openSheet\(\);/);
  assert.match(auctionCardPrice, /bottom-\[calc\(100%\+10px\)\]/);
  assert.match(auctionCardPrice, /onClickCapture=\{\(event\) => \{[^}]+swallowClick\(event\);[^}]+setOpen\(\(current\) => !current\);/s);
});

test("saved total changes are not mislabeled as currency impact", () => {
  assert.match(priceTrend, /trendUsesCurrency/);
  assert.match(priceTrend, /const currencyImpactRub = currencyDelta\(pricedOffer\) \|\| undefined/);
  assert.match(priceTrend, /const canShowRate = Boolean\(sheetRate\)/);
  assert.match(priceTrend, /\{sheetRate \? <CurrencyRatesSheet/);
  assert.match(priceTrend, /trendUsesCurrency \? "Показать влияние курса валюты" : "Показать курс валюты и полный расчёт"/);
  assert.match(priceTrend, /impactRub=\{currencyImpactRub\}/);
  assert.match(priceTrend, /Стрелка показывает изменение полного сохранённого расчёта\. Влияние курса указано отдельно\./);
});

test("mobile offer controls remain tappable", () => {
  assert.doesNotMatch(editablePower, /onBlur=/);
  assert.match(preliminaryPrice, /<button[\s\S]+aria-label="Почему цена предварительная"/);
  assert.doesNotMatch(preliminaryPrice, /aria-label="Почему цена предварительная"[\s\S]+onPointerDown=\{\(event\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); \}\}/);
  assert.match(priceTrend, /aria-label=\{panel && canShowRate \? `Показать курс \$\{currency\} и полный расчёт`/);
  assert.doesNotMatch(priceSheetCss, /@media \(max-width: 1023px\)[\\s\\S]+\\.ac-price-trend-panel\s*\{[\\s\\S]+pointer-events:\s*none !important/);
  assert.match(preliminaryPrice, /const \[lightTheme, setLightTheme\] = useState\(false\)/);
  assert.match(priceTrend, /const \[lightTheme, setLightTheme\] = useState\(false\)/);
});

test("theme bootstrap does not mutate managed head before hydration", () => {
  assert.match(rootLayout, /document\.documentElement\.dataset\.theme = theme/);
  assert.doesNotMatch(rootLayout, /document\.head\.appendChild\(link\)/);
  assert.doesNotMatch(rootLayout, /link\.href = theme ===/);
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
