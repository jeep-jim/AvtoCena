import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { approvedAutocatalogCovers, compileAutocatalogLetters } from "../scripts/autocatalog-publication-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verified = [{ sourceId: "official", fields: ["canonicalName"], status: "verified", confidence: "official" }];

test("publication shards preserve aliases, relations and field provenance", () => {
  const result = compileAutocatalogLetters({
    brands: [{ id: "toyota", canonicalName: "Toyota", slug: "toyota", aliases: [{ value: "Тойота", safe: true }], countries: ["Japan"], status: "verified", evidence: verified }],
    models: [{ id: "toyota/camry", brandId: "toyota", canonicalName: "Camry", slug: "camry", aliases: [{ value: "凯美瑞", safe: true }], sourceNames: [], status: "verified", evidence: verified }],
    generations: [{ id: "toyota/camry/xv70", modelId: "toyota/camry", name: "XV70", aliases: [], status: "verified", evidence: verified }],
    facelifts: [{ id: "toyota/camry/xv70/facelift", generationId: "toyota/camry/xv70", name: "Facelift", aliases: [], status: "review", evidence: verified }],
    variants: [{ id: "toyota/camry/xv70/2.5", modelId: "toyota/camry", generationId: "toyota/camry/xv70", name: "2.5", market: "Japan", powerHp: 203, status: "verified", aliases: [], evidence: [{ ...verified[0], fields: ["name", "powerHp"] }] }],
    sources: [{ id: "official", type: "manufacturer", title: "Toyota", publisher: "Toyota", url: "https://global.toyota/", confidence: "official" }],
    media: [],
  });
  assert.equal(result.letters[0].letter, "T");
  const brand = result.letters[0].brands[0];
  assert.deepEqual(brand.aliases, ["Тойота"]);
  assert.deepEqual(brand.models[0].aliases, ["凯美瑞"]);
  assert.equal(brand.models[0].facelifts[0].generationId, "toyota/camry/xv70");
  assert.equal(brand.models[0].variants[0].powerHp, 203);
  assert.deepEqual(brand.models[0].variants[0].evidence[0].fields, ["name", "powerHp"]);
  assert.equal(result.counts.publicVariants, 1);
});

test("only exact approved freely licensed Wikimedia covers are publishable", () => {
  const base = {
    ownerType: "model",
    ownerId: "toyota/camry",
    role: "canonical_cover",
    sourceId: "commons",
    originalUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Toyota_Camry.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Toyota_Camry.jpg",
    identityStatus: "exact_model",
    license: "CC BY-SA 4.0",
    attribution: "Photographer",
    status: "approved",
  };
  const rows = approvedAutocatalogCovers([
    { ...base, id: "accepted" },
    { ...base, id: "wrong-host", ownerId: "toyota/prius", originalUrl: "https://example.com/prius.jpg" },
    { ...base, id: "review", ownerId: "toyota/corolla", status: "review" },
    { ...base, id: "rights", ownerId: "toyota/yaris", license: "All rights reserved" },
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["accepted"]);
});

test("publisher is bounded, idempotent and has no third-party mirror mode", async () => {
  const source = await readFile(path.join(REPO_ROOT, "scripts/publish-autocatalog.mjs"), "utf8");
  assert.match(source, /MAX_MEDIA_DOWNLOADS[^\n]+60/);
  assert.match(source, /DOWNLOAD_DELAY_MS[^\n]+1_250/);
  assert.match(source, /MAX_STORAGE_WRITES[^\n]+120/);
  assert.match(source, /previousCovers/);
  assert.match(source, /ifNoneMatch: "\*"/);
  assert.match(source, /manifest written|MANIFEST_PATH|writeJson\(MANIFEST_PATH/);
  assert.doesNotMatch(source, /autohome\.com|drom\.ru/iu);
});

test("published covers are served only through checksum-bound local storage routes", async () => {
  const helper = await readFile(path.join(REPO_ROOT, "apps/web/lib/catalog/autocatalog-publication.ts"), "utf8");
  const route = await readFile(path.join(REPO_ROOT, "apps/web/app/(public)/api/catalog/autocatalog-cover/[checksum]/route.ts"), "utf8");
  assert.match(helper, /model-covers/);
  assert.match(helper, /\[a-f0-9\]\{64\}/);
  assert.match(helper, /CACHE_TTL_MS/);
  assert.match(route, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(route, /getBinary\(cover\.objectKey\)/);
  assert.match(route, /max-age=86400/);
});
