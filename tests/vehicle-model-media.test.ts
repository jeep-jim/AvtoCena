import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const mediaModule = fs.readFileSync(new URL("../apps/web/lib/catalog/model-media.ts", import.meta.url), "utf8");
const mediaImporter = fs.readFileSync(new URL("../scripts/catalog-import-vehicle-model-media.mjs", import.meta.url), "utf8");

test("vehicle model media is kept separate from listing images and requires source attribution", () => {
  assert.match(mediaModule, /catalog\/vehicle-knowledge\/model-media\.json/);
  assert.match(mediaModule, /sourceUrl: string/);
  assert.match(mediaModule, /modelId: string/);
  assert.match(mediaModule, /generation\?: string/);
  assert.match(mediaModule, /MAX_MODEL_IMAGES = 12/);
  assert.match(mediaModule, /findVehicleModelMedia/);
  assert.doesNotMatch(mediaModule, /VehicleOffer/);
});

test("model media importer enforces the rolling 15-year window and deduplicates photos", () => {
  assert.match(mediaImporter, /YEAR_FLOOR = new Date\(\)\.getFullYear\(\) - 15 \+ 1/);
  assert.match(mediaImporter, /VEHICLE_MODEL_MEDIA_MAX_IMAGES/);
  assert.match(mediaImporter, /image\?\.url \|\| image\?\.src \|\| image\?\.imageUrl \|\| image\?\.photoUrl/);
  assert.match(mediaImporter, /replace\(\/\[\?#\]\.\*\$\//);
  assert.match(mediaImporter, /sourceType: \["manufacturer", "official_catalog", "trusted_catalog", "manual"\]/);
});
