import test from "node:test";
import assert from "node:assert/strict";
import { applyEncyclopediaDisplayIdentity } from "../apps/web/lib/catalog/display-identity";

test("canonical display picks the longest safe Bentley model prefix and preserves calculation fields", async () => {
  const raw = {
    id: "bentley-card",
    market: "uae",
    make: "Bentley",
    model: "Continental GT STD",
    year: 2024,
    totalRub: 37_549_767,
    powerHp: 542,
    calculationStatus: "ready",
  };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, "Bentley");
  assert.equal(result.model, "Continental GT");
  assert.equal(result.totalRub, raw.totalRub);
  assert.equal(result.powerHp, raw.powerHp);
  assert.equal(result.calculationStatus, raw.calculationStatus);
  assert.equal(result.encyclopediaDisplayIdentity?.rawModel, "Continental GT STD");
  assert.equal(result.encyclopediaDisplayIdentity?.modelId, "bentley/continental-gt");
});

test("known model plus listing trim can be canonicalized without changing trim or power", async () => {
  const raw = {
    id: "sportage-card",
    market: "korea",
    make: "Kia",
    model: "Sportage V бензин 1.6 Turbo 2WD",
    trim: "Prestige",
    year: 2023,
    powerHp: 180,
    calculationStatus: "ready",
  };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, "Kia");
  assert.equal(result.model, "Sportage");
  assert.equal(result.trim, "Prestige");
  assert.equal(result.powerHp, 180);
  assert.equal(result.calculationStatus, "ready");
});

test("coachbuilder VITO is not silently promoted to Mercedes-Benz Vito", async () => {
  const raw = { id: "coachbuilder-vito", market: "china", make: "雅升汽车", model: "VITO", year: 2025, totalRub: 13_963_671 };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, raw.make);
  assert.equal(result.model, raw.model);
  assert.equal(result.encyclopediaDisplayIdentity, undefined);
});

test("KGM Rexton Sports Khan remains unresolved instead of collapsing into Rexton SUV", async () => {
  const raw = { id: "kgm-sports", market: "korea", make: "KGM(KGM)", model: "더 뉴 렉스턴 스포츠 칸 디젤 2.2 2WD", year: 2022 };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, raw.make);
  assert.equal(result.model, raw.model);
  assert.equal(result.encyclopediaDisplayIdentity, undefined);
});
