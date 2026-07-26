import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const brandRail = fs.readFileSync(new URL("../apps/web/components/catalog/BrandLogoRail.tsx", import.meta.url), "utf8");
const offerQuality = fs.readFileSync(new URL("../apps/web/lib/catalog/offer-quality.ts", import.meta.url), "utf8");
const galleryWrapper = fs.readFileSync(new URL("../apps/web/lib/catalog/full-gallery-wrapper.ts", import.meta.url), "utf8");
const flatUi = fs.readFileSync(new URL("../apps/web/app/flat-ui.css", import.meta.url), "utf8");

test("brand rail uses the existing catalog query instead of a missing route", () => {
  assert.match(brandRail, /href=\{`\/cars\?make=\$\{encodeURIComponent\(brand\)\}`\}/);
  assert.doesNotMatch(brandRail, /\/cars\/brand\//);
});

test("generic open sources cannot attach an unbounded page-wide gallery", () => {
  assert.match(galleryWrapper, /source\.sourceId\.endsWith\("_open"\)/);
  assert.match(galleryWrapper, /gallerySafetyMode/);
  assert.match(galleryWrapper, /listing_bound/);
  assert.match(galleryWrapper, /sourceNativeUrls\.length >= result\.length/);
});

test("catalog rejects implausible ordinary-car prices and power", () => {
  assert.match(offerQuality, /totalRub > 50_000_000/);
  assert.match(offerQuality, /performance \|\| commercial \? 1_500 : 650/);
  assert.match(offerQuality, /powerHp \/ engineCc > 0\.21/);
  assert.match(offerQuality, /hasPlausibleSourcePrice/);
});

test("dealer verification badge keeps absolute placement and company rows align at the top", () => {
  assert.doesNotMatch(flatUi, /\.dealer-verified-icon\{position:relative!important/);
  assert.match(flatUi, /align-items:flex-start!important/);
});
