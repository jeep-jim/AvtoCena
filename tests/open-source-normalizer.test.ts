import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOpenModel } from "../apps/web/lib/catalog/open-source-normalizer";

test("extracts a clean Japan model before chassis, trim and mileage", () => {
  assert.equal(
    canonicalOpenModel("2014 Toyota Harrier ZSU60W PREMIUM 193,300 km 1,986 cc", "Toyota"),
    "Harrier",
  );
  assert.equal(
    canonicalOpenModel("2014 Mazda CX-5 KE5FW 25S L PACKAGE 193,900 km", "Mazda"),
    "CX-5",
  );
});

test("keeps well-known multiword model names", () => {
  assert.equal(canonicalOpenModel("2021 Toyota Land Cruiser Prado TRJ150W", "Toyota"), "Land Cruiser Prado");
  assert.equal(canonicalOpenModel("2022 BMW 3 Series G20 320i", "BMW"), "3 Series");
  assert.equal(canonicalOpenModel("2023 Mercedes-Benz GLE Class W167", "Mercedes-Benz"), "GLE Class");
});
