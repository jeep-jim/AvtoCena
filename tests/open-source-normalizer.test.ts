import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOpenModel, canonicalSourceModelIdentity } from "../apps/web/lib/catalog/open-source-normalizer";

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

test("repairs generic Mercedes-Benz model identity from exact source titles", () => {
  assert.equal(canonicalSourceModelIdentity("Mercedes Benz A 200 AMG Line", "Mercedes", "Benz"), "A-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz E 200 Avantgarde", "Mercedes-Benz", "Benz"), "E-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz B 200 Progressive", "Mercedes-Benz", "Benz"), "B-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Vito 114 CDI", "Mercedes-Benz", "Benz"), "Vito");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Sprinter 319 CDI", "Mercedes-Benz", "Benz"), "Sprinter");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Klasa C 200", "Mercedes-Benz", "Benz"), "C-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz GLC 300 4MATIC", "Mercedes-Benz", "Benz"), "GLC Class");
});

test("repairs compact diesel suffixes and explicit AWD prefixes", () => {
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz A 200d Progressive Advanced", "Mercedes-Benz", "Benz"), "A-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz E 300de 4MATIC", "Mercedes-Benz", "Benz"), "E-Class");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz ALLRAD SPRINTER 314 4X4 DOKA", "Mercedes-Benz", "Benz"), "Sprinter");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz 4MATIC GLC 300", "Mercedes-Benz", "Benz"), "GLC Class");
});

test("source identity repair remains fail-closed for unrelated brands and unknown Mercedes shapes", () => {
  assert.equal(canonicalSourceModelIdentity("BMW 320i M Sport", "BMW", "3 Series"), "3 Series");
  assert.equal(canonicalSourceModelIdentity("Mercedes-Benz Unknown Special", "Mercedes-Benz", "Benz"), "Benz");
});
