import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("public encyclopedia uses a permanent snapshot and keeps legacy navigation", () => {
 const page=source("apps/web/app/(public)/cars/autocatalog/page.tsx");
 assert.match(page,/Энциклопедия автомобилей/);
 assert.match(page,/readEncyclopedia/);
 assert.doesNotMatch(page,/readAutocatalogCounts|readCatalogBrandDirectory/);
 assert.match(source("apps/web/app/(public)/cars/encyclopedia/page.tsx"),/redirect/);
 assert.match(source("apps/web/app/robots.txt/route.ts"),/autocatalog\/sitemap.xml/);
});

test("brand logos never disappear and the public request path does not crawl a third-party site", () => {
  const visual = source("apps/web/components/catalog/BrandLogoRail.tsx");
  const route = source("apps/web/app/api/catalog/brand-logo/[slug]/route.ts");

  assert.match(visual, /Логотип \$\{brand\} проверяется/);
  assert.match(visual, /const initials/);
  assert.match(visual, /`\/brand-logos\/local\/\$\{theme\}\/\$\{slug\}\.png`[\s\S]*`\/api\/catalog\/brand-logo/);
  assert.match(visual, /\(previous\?\.count \|\| 0\) \+ count/);
  assert.match(route, /LOGO_ROOTS/);
  assert.match(route, /params: Promise<\{ slug: string \}>/);
  assert.match(route, /const \{ slug \} = await params/);
  assert.doesNotMatch(route, /fetch\(/);
  assert.doesNotMatch(route, /retired\.example/);
});

test("every remaining live brand logo gap has local light and dark assets", () => {
  const supplement = JSON.parse(source("data/catalog/brand-logo-supplement.json"));
  const slugs = supplement.brands.map((brand: { slug: string }) => brand.slug);

  assert.deepEqual(slugs, [...slugs].sort((left, right) => left.localeCompare(right, "en")));
  assert.equal(supplement.policy.visitorThirdPartyRequests, false);
  assert.equal(new Set(slugs).size, 16);

  for (const slug of slugs) {
    for (const theme of ["light", "dark"]) {
      const asset = new URL(`../apps/web/public/brand-logos/local/${theme}/${slug}.png`, import.meta.url);
      assert.ok(fs.statSync(asset).size > 1_000, `${theme}/${slug}.png must be a real local logo`);
    }
  }
});

test("brand and model pages use Autocatalog copy, saved previews and no aggregate pseudo-specs", () => {
  const brandPage = source("apps/web/app/(public)/cars/brand/[slug]/page.tsx");
  const modelPage = source("apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx");
  const modelLayout = source("apps/web/app/(public)/cars/brand/[slug]/model/[model]/layout.tsx");
  const modelDirectory = source("apps/web/components/catalog/BrandModelDirectory.tsx");

  assert.match(brandPage, /modelsWithPreviews/);
  assert.match(brandPage, /backHref="\/cars"/);
  assert.match(brandPage, /MARKET_ORDER\.map/);
  assert.match(brandPage, /BrandMarketOffers/);
  assert.doesNotMatch(brandPage, /makeResults\.reduce/);
  assert.doesNotMatch(brandPage, /availableMarkets\.length \|\| 7/);
  assert.match(modelPage, /heroImageUrl/);
  assert.match(modelPage, /Автокаталог/);
  assert.match(modelDirectory, /model\.previewUrl/);
  assert.match(brandPage, /previewUrl: \(published \? autocatalogCoverUrl\(published\) : undefined\)/);
  assert.doesNotMatch(modelDirectory, /Характеристики дополняются|specRanges|representativePowerHp/);
  assert.doesNotMatch(modelPage, /specRanges|representativePowerHp/);
  assert.match(modelPage, /Характеристики из базы знаний/);
  assert.match(modelPage, /row\.status==="reference"/);
  assert.match(modelPage, /Сверьте год, двигатель и комплектацию/);
  assert.doesNotMatch(modelLayout, /readVehicleKnowledgeVariants|Описание и характеристики|Мощность|Тип топлива|Привод/);
});

test("removed offers explain availability and offer catalog navigation", () => {
  const offerPage = source("apps/web/app/(public)/cars/offer/[id]/page.tsx");
  assert.match(offerPage, /if \(!storedOffer\) return <UnavailableOffer/);
  assert.match(offerPage, /if \(!retro && !directScenario && !savedCalculation && !visibleRub && !selectionRequired && !sellerPricing && !isPriceOnRequestDubicarsOffer\(raw\)\) return <UnavailableOffer/);
  assert.doesNotMatch(offerPage, /notFound\(\)/);
  assert.doesNotMatch(offerPage, /!offer \|\| !isCrediblePublicOffer\(offer\)/);
  assert.doesNotMatch(offerPage, /function MissingOffer/);
});

test("Autocatalog is not injected into the public catalog header or hero", () => {
  const header = source("apps/web/components/layout/PublicHeader.tsx");
  const catalogPage = source("apps/web/components/catalog/CatalogContent.tsx");
  assert.doesNotMatch(header, /href="\/cars\/autocatalog"/);
  assert.doesNotMatch(catalogPage, /Автокаталог →/);
});
