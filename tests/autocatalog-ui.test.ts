import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("public vehicle knowledge is presented as Autocatalog with a legacy redirect", () => {
  const page = source("apps/web/app/(public)/cars/autocatalog/page.tsx");
  const directory = source("apps/web/components/catalog/AutocatalogBrandDirectory.tsx");
  const legacy = source("apps/web/app/(public)/cars/encyclopedia/page.tsx");
  const sitemap = source("apps/web/app/sitemap.xml/route.ts");

  assert.match(page, />Автокаталог</);
  assert.match(page, /readCatalogBrandDirectory/);
  assert.match(page, /readEncyclopediaKnowledgeModels/);
  assert.match(directory, /Все марки по алфавиту/);
  assert.match(directory, /brand\.aliases/);
  assert.match(directory, /#brands-/);
  assert.match(legacy, /redirect\("\/cars\/autocatalog"\)/);
  assert.match(sitemap, /\/cars\/autocatalog/);
  assert.doesNotMatch(sitemap, /\/cars\/encyclopedia/);
});

test("brand logos never disappear and the public request path does not crawl a third-party site", () => {
  const visual = source("apps/web/components/catalog/BrandLogoRail.tsx");
  const route = source("apps/web/app/api/catalog/brand-logo/[slug]/route.ts");

  assert.match(visual, /Логотип \$\{brand\} проверяется/);
  assert.match(visual, /const initials/);
  assert.match(route, /LOGO_ROOTS/);
  assert.doesNotMatch(route, /fetch\(/);
  assert.doesNotMatch(route, /drom\.ru/);
});

test("brand and model pages use Autocatalog copy and model previews", () => {
  const brandPage = source("apps/web/app/(public)/cars/brand/[slug]/page.tsx");
  const modelPage = source("apps/web/app/(public)/cars/brand/[slug]/model/[model]/page.tsx");
  const modelDirectory = source("apps/web/components/catalog/BrandModelDirectory.tsx");

  assert.match(brandPage, /modelsWithPreviews/);
  assert.match(brandPage, /\/cars\/autocatalog/);
  assert.match(modelPage, /modelPreviewUrl/);
  assert.match(modelPage, /Автокаталог/);
  assert.match(modelDirectory, /model\.previewUrl/);
  assert.match(modelDirectory, /Характеристики дополняются/);
});
