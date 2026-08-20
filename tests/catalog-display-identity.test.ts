import test from "node:test";
import assert from "node:assert/strict";
import { applyEncyclopediaDisplayIdentity } from "../apps/web/lib/catalog/display-identity";
import { canonicalCatalogBrand, catalogBrandSlug } from "../apps/web/lib/catalog/brands";
import { publicCatalogIdentityRejectionReason } from "../apps/web/lib/catalog/public-identity-policy";

test("public brand groups collapse market and sub-brand spellings to one route", () => {
  for (const alias of ["Audi", "AUDI China", "Audi AG"]) {
    assert.equal(canonicalCatalogBrand(alias), "Audi");
    assert.equal(catalogBrandSlug(alias), "audi");
  }
  for (const alias of ["Changan", "Changan NEVO", "Changan Qiyuan", "Changan Oshan", "Oshan"]) {
    assert.equal(canonicalCatalogBrand(alias), "Changan");
    assert.equal(catalogBrandSlug(alias), "changan");
  }
  assert.equal(canonicalCatalogBrand("AITO Wenjie"), "AITO");
  assert.equal(canonicalCatalogBrand("Besturn"), "Bestune");
  assert.equal(canonicalCatalogBrand("BAW (Beijing Automobile Works)"), "BAW");
  assert.equal(canonicalCatalogBrand("Beijing Automobile Works"), "BAW");
  for (const [alias, parent] of [
    ["Audi AUDI", "Audi"],
    ["BAIC ORV", "BAIC"],
    ["Chery Fengyun", "Chery"],
    ["Chery Fulwin", "Chery"],
    ["Dongfeng Fengdu", "Dongfeng"],
    ["Dongfeng Fengxing", "Dongfeng"],
    ["Dongfeng Yipai", "Dongfeng"],
    ["DR Automobiles", "DR"],
    ["DS Automobiles", "DS"],
    ["FANGCHENGBAO", "Fang Cheng Bao"],
    ["GAC Aion", "AION"],
    ["GAC Haobo", "HYPTEC"],
    ["GAC Trumpchi", "GAC"],
    ["Geely Geometry", "Geely"],
    ["INEOS Grenadier", "INEOS"],
    ["JAC Motors", "JAC"],
    ["JAC Refine", "JAC"],
    ["Jetour Shanhai", "Jetour"],
    ["KGM(KGM)", "KGM"],
    ["Lotus Cars", "Lotus"],
    ["Renault Korea", "Renault"],
    ["Renault Samsung", "Renault"],
    ["Voyah Auto", "Voyah"],
    ["Wuling Motors", "Wuling"],
    ["Xiaomi Auto", "Xiaomi"],
    ["Yasheng Auto", "Yasheng"],
  ]) assert.equal(canonicalCatalogBrand(alias), parent);
});

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

test("China coachbuilder VITO is presented under its verified base vehicle brand", async () => {
  const raw = { id: "coachbuilder-vito", market: "china", make: "雅升汽车", model: "VITO", year: 2025, totalRub: 13_963_671 };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, "Mercedes-Benz");
  assert.equal(result.model, "Vito");
  assert.equal(result.encyclopediaDisplayIdentity?.match, "trusted_alias");
});

test("China coachbuilders resolve to the verified Mercedes-Benz Vito/V-Class base identity", async () => {
  const xiaoao = await applyEncyclopediaDisplayIdentity({
    id: "xiaoao-vito",
    market: "china",
    make: "AM晓澳汽车",
    model: "晓澳汽车 VITO",
    year: 2025,
  });
  const shangzhe = await applyEncyclopediaDisplayIdentity({
    id: "shangzhe-vclass",
    market: "china",
    make: "上喆汽车",
    model: "上喆 V Class",
    year: 2025,
  });
  const yasheng = await applyEncyclopediaDisplayIdentity({
    id: "yasheng-vito-duplicate",
    market: "china",
    make: "雅升汽车",
    model: "雅升 VITO",
    year: 2025,
  });

  assert.deepEqual([xiaoao.make, xiaoao.model], ["Mercedes-Benz", "Vito"]);
  assert.deepEqual([shangzhe.make, shangzhe.model], ["Mercedes-Benz", "V-Class"]);
  assert.deepEqual([yasheng.make, yasheng.model], ["Mercedes-Benz", "Vito"]);
  assert.equal(xiaoao.encyclopediaDisplayIdentity?.match, "trusted_alias");
  assert.equal(shangzhe.encyclopediaDisplayIdentity?.match, "trusted_alias");
});

test("raw Chinese official model aliases recover the base brand hidden by a coachbuilder label", async () => {
  const vClass = await applyEncyclopediaDisplayIdentity({
    id: "we昊-v-class",
    market: "china",
    make: "伟昊汽车",
    model: "塞里雅兰V级",
    year: 2025,
  });
  const vito = await applyEncyclopediaDisplayIdentity({
    id: "shangzhe-vito",
    market: "china",
    make: "上喆汽车",
    model: "浩达威霆",
    year: 2025,
  });

  assert.deepEqual([vClass.make, vClass.model], ["Mercedes-Benz", "V-Class"]);
  assert.deepEqual([vito.make, vito.model], ["Mercedes-Benz", "Vito"]);
});

test("AITO localized source spellings collapse to one public brand without duplicated make in model", async () => {
  const result = await applyEncyclopediaDisplayIdentity({
    id: "aito-wenjie",
    market: "china",
    make: "AITO 问界",
    model: "问界 M9",
    year: 2025,
  });
  assert.equal(result.make, "AITO");
  assert.equal(result.model, "M9");
});

test("KGM Rexton Sports Khan uses the exact official pickup identity instead of collapsing into Rexton SUV", async () => {
  const raw = { id: "kgm-sports", market: "korea", make: "KGM(KGM)", model: "더 뉴 렉스턴 스포츠 칸 디젤 2.2 2WD", year: 2022 };
  const result = await applyEncyclopediaDisplayIdentity(raw);
  assert.equal(result.make, "KGM");
  assert.equal(result.model, "Rexton Sports Khan");
  assert.equal(result.encyclopediaDisplayIdentity?.match, "trusted_alias");
});

test("Hyundai Grandeur Hybrid listing suffix is not exposed as a raw Korean model", async () => {
  const result = await applyEncyclopediaDisplayIdentity({ make: "현대", model: "그랜저 하이브리드 (GN7)", market: "korea" });
  assert.equal(result.make, "Hyundai");
  assert.equal(result.model, "Grandeur");
  assert.equal(result.encyclopediaDisplayIdentity?.match, "trusted_alias");
});

test("known Korean brands canonicalize without inventing an untranslated model", async () => {
  for (const [rawMake, canonicalMake, rawModel] of [
    ["기아", "Kia", "미확인차종"],
    ["현대", "Hyundai", "미확인차종"],
    ["벤츠", "Mercedes-Benz", "미확인차종"],
  ]) {
    const result = await applyEncyclopediaDisplayIdentity({ make: rawMake, model: rawModel, market: "korea" });
    assert.equal(result.make, canonicalMake);
    assert.equal(result.model, rawModel);
    assert.equal(result.encyclopediaDisplayIdentity?.rawMake, rawMake);
    assert.equal(result.encyclopediaDisplayIdentity?.rawModel, rawModel);
    assert.equal(result.encyclopediaDisplayIdentity?.match, "brand_only");
  }
});

test("unresolved China manufacturer labels stay out of the public catalog instead of being guessed", async () => {
  const huakai = await applyEncyclopediaDisplayIdentity({ make: "华凯", model: "华凯新能源", market: "china" });
  const huanghai = await applyEncyclopediaDisplayIdentity({ make: "HuangHai", model: "蛟龙新能源", market: "china" });
  assert.equal(publicCatalogIdentityRejectionReason(huakai), "unresolved_china_make");
  assert.deepEqual([huanghai.make, huanghai.model], ["Huanghai", "Jiaolong EV"]);
  assert.equal(publicCatalogIdentityRejectionReason(huanghai), "");
});

test("verified WALD City conversions are grouped under the Toyota Hiace base model", async () => {
  for (const model of ["City H7", "City S9"]) {
    const result = await applyEncyclopediaDisplayIdentity({ make: "WALD", model, market: "china" });
    assert.deepEqual([result.make, result.model], ["Toyota", "Hiace"]);
    assert.equal(publicCatalogIdentityRejectionReason(result), "");
  }

  const unresolved = await applyEncyclopediaDisplayIdentity({ make: "WALD", model: "City M7", market: "china" });
  assert.deepEqual([unresolved.make, unresolved.model], ["WALD", "City M7"]);
  assert.notEqual(unresolved.encyclopediaDisplayIdentity?.match, "trusted_alias");
});

test("Russian domestic listings do not enter the foreign import catalog", () => {
  assert.equal(publicCatalogIdentityRejectionReason({ market: "europe", make: "Lada" }), "unsupported_import_brand");
  assert.equal(publicCatalogIdentityRejectionReason({ market: "europe", make: "Volkswagen" }), "");
});
