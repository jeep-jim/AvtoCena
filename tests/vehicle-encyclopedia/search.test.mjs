import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../../scripts/vehicle-encyclopedia/lib.mjs";
import { buildSearchIndex, resolveSearch, resolveVehicleIdentity } from "../../scripts/vehicle-encyclopedia/search.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");
const index = buildSearchIndex(await loadWorkspace(DATA_ROOT));

test("canonical make/model and official short name resolve to Audi Q6", () => {
  assert.equal(resolveSearch(index, "Audi Q6 SUV e-tron").resolved?.entry.entityId, "audi/q6-e-tron");
  assert.equal(resolveSearch(index, "Q6 e-tron", { make: "Audi" }).resolved?.entry.entityId, "audi/q6-e-tron");
});

test("localized names resolve only when backed by an explicit source", () => {
  assert.equal(resolveSearch(index, "宝马i4").resolved?.entry.entityId, "bmw/i4");
  assert.equal(resolveSearch(index, "BYD・シール").resolved?.entry.entityId, "byd/seal");
  assert.equal(resolveSearch(index, "비야디 씰").resolved?.entry.entityId, "byd/seal");
  assert.equal(resolveSearch(index, "아우디 Q6 e-트론").resolved?.entry.entityId, "audi/q6-e-tron");
  assert.equal(resolveSearch(index, "Citroen C3").resolved?.entry.entityId, "citroen/c3");
  assert.equal(resolveSearch(index, "ë-C3", { make: "Citroen" }).resolved?.entry.entityId, "citroen/c3");
});

test("localized make names resolve to one English public brand identity", () => {
  assert.equal(resolveSearch(index, "Changan Qiyuan").resolved?.entry.entityId, "changan-nevo");
  assert.equal(resolveSearch(index, "长安启源").resolved?.canonical.canonicalMake, "Changan NEVO");
  assert.equal(resolveSearch(index, "Chery Fengyun").resolved?.entry.entityId, "chery");
  assert.equal(resolveSearch(index, "奇瑞风云").resolved?.canonical.canonicalMake, "Chery");
  assert.equal(resolveSearch(index, "Changan Oshan").resolved?.entry.entityId, "oshan");
  assert.equal(resolveSearch(index, "기아").resolved?.canonical.canonicalMake, "Kia");
  assert.equal(resolveSearch(index, "현대").resolved?.canonical.canonicalMake, "Hyundai");
  assert.equal(resolveSearch(index, "아우디").resolved?.canonical.canonicalMake, "Audi");
  assert.equal(resolveSearch(index, "Geely Auto").resolved?.canonical.canonicalMake, "Geely");
});

test("remaining official Japan names stay linked to English canonical models", () => {
  const cases = [
    ["GRカローラ", "Toyota", "toyota/gr-corolla"],
    ["プリウス α", "Toyota", "toyota/prius-alpha"],
    ["Prius Alpha", "Toyota", "toyota/prius-alpha"],
    ["N-BOX SLASH", "Honda", "honda/n-box-slash"],
    ["フィット シャトル", "Honda", "honda/fit-shuttle"],
    ["エクシーガ", "Subaru", "subaru/exiga"],
    ["トレジア*", "Subaru", "subaru/trezia"],
    ["AZ-オフロード", "Mazda", "mazda/az-offroad"],
    ["ディアス", "Subaru", "subaru/dias-wagon"],
    ["アトレーワゴン", "Daihatsu", "daihatsu/atrai-wagon"],
    ["アルティス", "Daihatsu", "daihatsu/altis"],
    ["メビウス", "Daihatsu", "daihatsu/mebius"],
    ["カローラ ルミオン", "Toyota", "toyota/corolla-rumion"],
    ["プラウディア", "Mitsubishi", "mitsubishi/proudia"],
    ["ディグニティ", "Mitsubishi", "mitsubishi/dignity"],
    ["ランサーエボ", "Mitsubishi", "mitsubishi/lancer-evolution"],
    ["ランサーエボリューション", "Mitsubishi", "mitsubishi/lancer-evolution"],
    ["プレミオ", "Toyota", "toyota/premio"],
    ["エスクァイア", "Toyota", "toyota/esquire"],
    ["クラウンコンフォート", "Toyota", "toyota/crown-comfort"],
    ["タンク", "Toyota", "toyota/tank"],
    ["スクラム", "Mazda", "mazda/scrum"],
    ["デリカ D:3", "Mitsubishi", "mitsubishi/delica-d3"],
  ];
  for (const [query, make, entityId] of cases) {
    const result = resolveSearch(index, query, { make });
    assert.equal(result.resolved, null);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.entry.safe, false);
  }
});

test("official Japan import and German-group spellings map to one English model", () => {
  const cases = [
    ["HS250h", "Lexus", "lexus/hs"],
    ["Abarth 124 Spider", "Abarth", "abarth/124-spider"],
    ["ナイトロ", "Dodge", "dodge/nitro"],
    ["ボルボXC70", "Volvo", "volvo/xc70"],
    ["BMW 840i クーペ", "BMW", "bmw/8-series"],
    ["TTRS Coupé (S-tronic)", "Audi", "audi/tt-rs"],
    ["メルセデスAMG G63", "Mercedes-Benz", "mercedes-benz/g-class"],
    ["MINI Cooper ペースマン", "Mini", "mini/paceman"],
  ];
  for (const [query, make, entityId] of cases) {
    const result = resolveSearch(index, query, { make });
    assert.equal(result.resolved, null);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.entry.safe, false);
  }

  assert.equal(resolveSearch(index, "Mini クーパーD クロスオーバー", { make: "Mercedes-Benz" }).matches.length, 0);
});

test("repaired group-name duplicates no longer exist as canonical models", async () => {
  const workspace = await loadWorkspace(DATA_ROOT);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  for (const removedId of ["honda/cr", "bmw/mini", "bmw/mini-cooper", "bmw/cooper", "bmw/clubman-cooper"]) {
    assert.equal(models.has(removedId), false);
  }
  assert(models.get("honda/cr-v")?.sourceNames.some((sourceName) => sourceName.market === "Europe"));
  assert(models.get("mini/cooper")?.sourceNames.some((sourceName) => sourceName.value.includes("MINI Cooper")));
});

test("platform codes preserve model context", () => {
  const result = resolveSearch(index, "G26", { make: "BMW" });
  assert.equal(result.resolved?.entry.entityType, "generation");
  assert.equal(result.resolved?.entry.modelId, "bmw/i4");
});

test("checkpoint seeds are searchable without being treated as verified exports", () => {
  assert.equal(resolveSearch(index, "Golf", { make: "VW" }).resolved?.entry.entityId, "volkswagen/golf");
  assert.equal(resolveSearch(index, "Leaf", { make: "Nissan" }).resolved?.entry.entityId, "nissan/leaf");
  assert.equal(resolveSearch(index, "Tucson", { make: "Hyundai" }).resolved?.entry.entityId, "hyundai/tucson");
  assert.equal(resolveSearch(index, "EV6", { make: "Kia" }).resolved?.entry.entityId, "kia/ev6");
  assert.equal(resolveSearch(index, "CX-60", { make: "Mazda" }).resolved?.entry.entityId, "mazda/cx-60");
  assert.equal(resolveSearch(index, "RZ", { make: "Lexus" }).resolved?.entry.entityId, "lexus/rz");
  assert.equal(resolveSearch(index, "EX30", { make: "Volvo" }).resolved?.entry.entityId, "volvo/ex30");
  assert.equal(resolveSearch(index, "Taycan", { make: "Porsche" }).resolved?.entry.entityId, "porsche/taycan");
  assert.equal(resolveSearch(index, "Mustang Mach-E", { make: "Ford" }).resolved?.entry.entityId, "ford/mustang-mach-e");
  assert.equal(resolveSearch(index, "Blazer EV", { make: "Chevrolet" }).resolved?.entry.entityId, "chevrolet/blazer-ev");
  assert.equal(resolveSearch(index, "Model 3", { make: "Tesla" }).resolved?.entry.entityId, "tesla/model-3");
  assert.equal(resolveSearch(index, "Tiggo 7 Pro Max", { make: "Chery" }).resolved?.entry.entityId, "chery/tiggo-7-pro-max");
  assert.equal(resolveSearch(index, "HAVAL H6").resolved?.entry.entityId, "haval/h6");
  assert.equal(resolveSearch(index, "Abarth 500e").resolved?.entry.entityId, "abarth/500e");
  assert.equal(resolveSearch(index, "ZDX", { make: "Acura" }).resolved?.entry.entityId, "acura/zdx");
  assert.equal(resolveSearch(index, "Milano", { make: "Alfa Romeo" }).resolved?.entry.entityId, "alfa-romeo/junior");
  assert.equal(resolveSearch(index, "DB12", { make: "Aston Martin" }).resolved?.entry.entityId, "aston-martin/db12");
  assert.equal(resolveSearch(index, "Continental GT", { make: "Bentley" }).resolved?.entry.entityId, "bentley/continental-gt");
});

test("new review models are visible for research but cannot auto-resolve pricing", () => {
  const result = resolveSearch(index, "A1", { make: "Audi" });
  assert.equal(result.resolved, null);
  assert.equal(result.ambiguous, false);
  assert.equal(result.matches[0]?.entry.entityId, "audi/a1");
  assert.equal(result.matches[0]?.entry.safe, false);
  assert.equal(result.matches[0]?.canonical.status, "review");

  const sourceSpelling = resolveSearch(index, "500X", { make: "Fiat" });
  assert.equal(sourceSpelling.resolved, null);
  assert.equal(sourceSpelling.matches[0]?.entry.entityId, "fiat/500-x");
  assert.equal(sourceSpelling.matches[0]?.entry.safe, false);
});

test("reviewed Europe spellings converge on one English model identity", () => {
  const cases = [
    ["TUCSONIX35", "Hyundai", "hyundai/tucson"],
    ["KOMBI", "Volkswagen", "volkswagen/transporter"],
    ["M340D XDRIVE", "BMW", "bmw/3-series"],
    ["LEXUS RX450H", "Lexus", "lexus/rx"],
    ["RS Q3 SPORTBACK", "Audi", "audi/rsq3"],
    ["MG MG 5 ELECTRIC", "MG", "mg-motor/mg5"],
    ["NISSAN NV300", "Nissan", "nissan/nv300"],
    ["COOLRAY", "Geely", "geely/coolray"],
  ];
  for (const [query, make, entityId] of cases) {
    const result = resolveSearch(index, query, { make });
    assert.equal(result.resolved, null);
    assert.equal(result.ambiguous, false);
    assert.equal(result.matches[0]?.entry.entityId, entityId);
    assert.equal(result.matches[0]?.entry.safe, false);
    assert.notEqual(result.matches[0]?.canonical.status, "verified");
  }
  assert.equal(resolveSearch(index, "SERIE X", { make: "BMW" }).matches.length, 0);
});

test("market title variants resolve to canonical English identity and exact sourced specs", () => {
  const blackStyle = resolveVehicleIdentity(index, { title: "Honda Wr V Z+ Black Style" });
  assert.equal(blackStyle.status, "resolved");
  assert.equal(blackStyle.resolved?.canonicalMake, "Honda");
  assert.equal(blackStyle.resolved?.canonicalModel, "WR-V");
  assert.equal(blackStyle.resolved?.canonicalVariant, "Z+ BLACK STYLE");
  assert.equal(blackStyle.resolved?.specs.powerHp, 118);
  assert.equal(blackStyle.resolved?.specs.powerKw, 87);
  assert.equal(blackStyle.resolved?.specs.engineCc, undefined);

  const x = resolveVehicleIdentity(index, { title: "Honda Wr V X" });
  const zPlus = resolveVehicleIdentity(index, { title: "Honda Wr V Z+" });
  assert.equal(x.resolved?.entityId, "honda/wr-v/japan-dg5/x-jp");
  assert.equal(zPlus.resolved?.entityId, "honda/wr-v/japan-dg5/z-plus-jp");

  const ec3 = resolveVehicleIdentity(index, { make: "Citroen", model: "C3", trim: "e-C3 320 km WLTP" });
  assert.equal(ec3.status, "resolved");
  assert.equal(ec3.resolved?.canonicalMake, "Citroën");
  assert.equal(ec3.resolved?.canonicalModel, "C3");
  assert.equal(ec3.resolved?.canonicalVariant, "ë-C3 320 km WLTP");
  assert.equal(ec3.resolved?.specs.powerKw, 83);
  assert.equal(ec3.resolved?.specs.rangeKm, 320);
  assert.equal(ec3.resolved?.specs.batteryGrossKwh, undefined);
});

test("Toyota Japan mass-market titles resolve to English identities and exact catalog specs", () => {
  const yaris = resolveVehicleIdentity(index, { title: "Toyota Yaris Hybrid Z 1.5 e-CVT E-Four" });
  assert.equal(yaris.status, "resolved");
  assert.equal(yaris.resolved?.entityId, "toyota/yaris/japan-2020/hybrid-z-1-5-ecvt-e-four");
  assert.equal(yaris.resolved?.canonicalModel, "Yaris");
  assert.equal(yaris.resolved?.specs.engineCode, "M15A-FXE");
  assert.equal(yaris.resolved?.specs.engineCc, 1490);
  assert.equal(yaris.resolved?.specs.icePowerKw, 67);
  assert.equal(yaris.resolved?.specs.powerKw, undefined);

  const sienta = resolveVehicleIdentity(index, { title: "Toyota Sienta Hybrid Z 1.5 e-CVT E-Four 7-seat" });
  assert.equal(sienta.status, "resolved");
  assert.equal(sienta.resolved?.entityId, "toyota/sienta/third-generation/hybrid-z-1-5-ecvt-e-four-7-seat");
  assert.equal(sienta.resolved?.specs.seats, 7);
  assert.equal(sienta.resolved?.specs.drive, "E-Four");

  assert.equal(resolveSearch(index, "アクア", { make: "トヨタ" }).resolved?.entry.entityId, "toyota/aqua");
  assert.equal(resolveSearch(index, "ヤリスクロス", { make: "Toyota" }).resolved?.entry.entityId, "toyota/yaris-cross");
});

test("current Corolla family and Prius listings stay separated by body and powertrain", () => {
  const sedan = resolveVehicleIdentity(index, { title: "Toyota Corolla HYBRID W×B 1.8 e-CVT E-Four" });
  const touring = resolveVehicleIdentity(index, { title: "Toyota Corolla Touring HYBRID W×B 1.8 e-CVT E-Four" });
  const sport = resolveVehicleIdentity(index, { title: "Toyota Corolla Sport HYBRID G Z Active Elegance 1.8 e-CVT FWD" });
  assert.equal(sedan.resolved?.entityId, "toyota/corolla/japan-2019/hybrid-wxb-1-8-ecvt-e-four");
  assert.equal(sedan.resolved?.specs.bodyType, "Sedan");
  assert.equal(touring.resolved?.entityId, "toyota/corolla-touring/japan-2019/hybrid-wxb-1-8-ecvt-e-four");
  assert.equal(touring.resolved?.specs.bodyType, "Station wagon");
  assert.equal(sport.resolved?.entityId, "toyota/corolla-sport/japan-2018/hybrid-g-z-active-elegance-1-8-ecvt-fwd");
  assert.equal(sport.resolved?.specs.bodyType, "Hatchback");

  const prius = resolveVehicleIdentity(index, { title: "Toyota Prius PHEV Z 2.0 e-CVT FWD" });
  assert.equal(prius.status, "resolved");
  assert.equal(prius.resolved?.entityId, "toyota/prius/japan-2023/phev-z-2-0-ecvt-fwd");
  assert.equal(prius.resolved?.specs.powertrainKind, "PHEV");
  assert.equal(prius.resolved?.specs.engineCode, "M20A-FXS");
  assert.equal(prius.resolved?.specs.icePowerKw, 113);
  assert.equal(prius.resolved?.specs.powerKw, undefined);
  assert.equal(resolveSearch(index, "プリウス", { make: "トヨタ" }).resolved?.entry.entityId, "toyota/prius");
});

test("Japanese market titles compose localized aliases into canonical English identities", () => {
  const swift = resolveVehicleIdentity(index, { title: "スズキ スイフト HYBRID MX CVT 4WD" });
  assert.equal(swift.status, "resolved");
  assert.equal(swift.resolved?.canonicalMake, "Suzuki");
  assert.equal(swift.resolved?.canonicalModel, "Swift");
  assert.equal(swift.resolved?.canonicalVariant, "HYBRID MX CVT 4WD");
  assert.equal(swift.resolved?.specs.engineCode, "Z12E");
  assert.equal(swift.resolved?.specs.engineCc, 1197);
  assert.equal(swift.resolved?.specs.icePowerKw, 60);

  const fit = resolveVehicleIdentity(index, { title: "ホンダ フィット e:HEV HOME BLACK STYLE 4WD" });
  assert.equal(fit.status, "resolved");
  assert.equal(fit.resolved?.canonicalMake, "Honda");
  assert.equal(fit.resolved?.canonicalModel, "Fit");
  assert.equal(fit.resolved?.canonicalVariant, "e:HEV HOME BLACK STYLE e-CVT 4WD");
  assert.equal(fit.resolved?.specs.motorPeakKw, 90);
  assert.equal(fit.resolved?.specs.power30MinKw, undefined);

  const note = resolveVehicleIdentity(index, { title: "日産 ノート X FOUR（4WD）" });
  assert.equal(note.status, "resolved");
  assert.equal(note.resolved?.canonicalMake, "Nissan");
  assert.equal(note.resolved?.canonicalModel, "Note");
  assert.equal(note.resolved?.canonicalVariant, "X FOUR e-POWER 4WD");
  assert.equal(note.resolved?.specs.engineCode, "HR12DE");

  const nBox = resolveVehicleIdentity(index, { title: "ホンダ エヌボックス CUSTOM ターボ 4WD" });
  assert.equal(nBox.status, "resolved");
  assert.equal(nBox.resolved?.canonicalMake, "Honda");
  assert.equal(nBox.resolved?.canonicalModel, "N-BOX");
  assert.equal(nBox.resolved?.canonicalVariant, "Custom Turbo CVT 4WD");
  assert.equal(nBox.resolved?.specs.engineCode, "S07B");
  assert.equal(nBox.resolved?.specs.engineCc, 658);
  assert.equal(nBox.resolved?.specs.powerHp, 64);

  const nBox2020 = resolveVehicleIdentity(index, { title: "ホンダ N BOX Custom L・ターボ 4WD" });
  assert.equal(nBox2020.status, "resolved");
  assert.equal(nBox2020.resolved?.canonicalModel, "N-BOX");
  assert.equal(nBox2020.resolved?.canonicalVariant, "Custom L Turbo CVT 4WD");
  assert.equal(nBox2020.resolved?.specs.engineCc, 658);
  assert.equal(nBox2020.resolved?.specs.powerKw, 47);

  const nWgn = resolveVehicleIdentity(index, { title: "ホンダ エヌワゴン CUSTOM L・ターボ 特別仕様車 BLACK STYLE 4WD" });
  assert.equal(nWgn.status, "resolved");
  assert.equal(nWgn.resolved?.canonicalMake, "Honda");
  assert.equal(nWgn.resolved?.canonicalModel, "N-WGN");
  assert.equal(nWgn.resolved?.canonicalVariant, "Custom L Turbo Black Style CVT 4WD");
  assert.equal(nWgn.resolved?.specs.engineCode, "S07B");
  assert.equal(nWgn.resolved?.specs.engineCc, 658);
  assert.equal(nWgn.resolved?.specs.powerHp, 64);

  const nWgnEnglish = resolveVehicleIdentity(index, { title: "Honda N WGN L Fashion Style FF" });
  assert.equal(nWgnEnglish.status, "resolved");
  assert.equal(nWgnEnglish.resolved?.canonicalModel, "N-WGN");
  assert.equal(nWgnEnglish.resolved?.canonicalVariant, "L Fashion Style CVT FF");
  assert.equal(nWgnEnglish.resolved?.specs.powerKw, 43);

  const nOne = resolveVehicleIdentity(index, { title: "ホンダ エヌワン Premium Tourer 4WD" });
  assert.equal(nOne.status, "resolved");
  assert.equal(nOne.resolved?.canonicalModel, "N-ONE");
  assert.equal(nOne.resolved?.canonicalVariant, "Premium Tourer CVT 4WD");
  assert.equal(nOne.resolved?.specs.engineCode, "S07B");
  assert.equal(nOne.resolved?.specs.engineCc, 658);
  assert.equal(nOne.resolved?.specs.powerKw, 47);

  const nOneCraft = resolveVehicleIdentity(index, { title: "Honda N ONE Original Craft Style FF" });
  assert.equal(nOneCraft.status, "resolved");
  assert.equal(nOneCraft.resolved?.canonicalVariant, "Original Craft Style CVT FF");
  assert.equal(nOneCraft.resolved?.specs.powerHp, 58);

  const nOneElectric = resolveVehicleIdentity(index, { title: "ホンダ N-ONE e：G FF" });
  assert.equal(nOneElectric.status, "resolved");
  assert.equal(nOneElectric.resolved?.canonicalModel, "N-ONE e:");
  assert.equal(nOneElectric.resolved?.canonicalVariant, "e:G FF");
  assert.equal(nOneElectric.resolved?.specs.motorPeakKw, 47);
  assert.equal(nOneElectric.resolved?.specs.rangeKm, 295);
  assert.equal(nOneElectric.resolved?.specs.power30MinKw, undefined);

  const vezelPlay = resolveVehicleIdentity(index, { title: "ホンダ ヴェゼル e:HEV Z・PLaYパッケージ 4WD" });
  assert.equal(vezelPlay.status, "resolved");
  assert.equal(vezelPlay.resolved?.canonicalModel, "Vezel");
  assert.equal(vezelPlay.resolved?.canonicalVariant, "e:HEV Z PLaY Package e-CVT 4WD");
  assert.equal(vezelPlay.resolved?.specs.engineCode, "LEC");
  assert.equal(vezelPlay.resolved?.specs.engineCc, 1496);
  assert.equal(vezelPlay.resolved?.specs.icePowerKw, 78);
  assert.equal(vezelPlay.resolved?.specs.motorPeakKw, 96);
  assert.equal(vezelPlay.resolved?.specs.powerKw, undefined);
  assert.equal(vezelPlay.resolved?.specs.power30MinKw, undefined);

  const vezelHunt = resolveVehicleIdentity(index, { title: "Honda Vezel eHEV X HuNT Package FF" });
  assert.equal(vezelHunt.status, "resolved");
  assert.equal(vezelHunt.resolved?.entityId, "honda/vezel/japan-2021/facelift-2024/ehev-x-hunt-package-ff");
  assert.equal(vezelHunt.resolved?.specs.drive, "FF");

  const vezelG = resolveVehicleIdentity(index, { title: "ホンダ VEZEL G 4WD" });
  assert.equal(vezelG.status, "resolved");
  assert.equal(vezelG.resolved?.canonicalVariant, "G CVT 4WD");
  assert.equal(vezelG.resolved?.specs.engineCode, "L15Z");
  assert.equal(vezelG.resolved?.specs.powerHp, 118);
  assert.equal(vezelG.resolved?.specs.powerKw, 87);

  assert.equal(resolveSearch(index, "マツダ ツー", { make: "マツダ" }).resolved?.entry.entityId, "mazda/mazda2");
  assert.equal(resolveSearch(index, "インプレッサ", { make: "スバル" }).resolved?.entry.entityId, "subaru/impreza");
  assert.equal(resolveSearch(index, "デリカミニ", { make: "三菱" }).resolved?.entry.entityId, "mitsubishi/delica-mini");
  assert.equal(resolveSearch(index, "タント", { make: "ダイハツ" }).resolved?.entry.entityId, "daihatsu/tanto");
});

test("unknown coachbuilder makes are candidates only and never silently rebound to Mercedes-Benz", () => {
  for (const input of [
    { make: "雅升汽车", model: "VITO" },
    { make: "AM", model: "VITO" },
    { make: "上莆", model: "V Class" },
    { title: "雅升汽车 VITO" },
    { title: "AM VITO" },
    { title: "上莆 V Class" },
  ]) {
    const result = resolveVehicleIdentity(index, input);
    assert.equal(result.status, "make_conflict");
    assert.equal(result.resolved, null);
    assert.equal(result.candidate?.canonicalMake, "Mercedes-Benz");
  }
  assert.equal(resolveVehicleIdentity(index, { make: "华凯", model: "新能源" }).status, "unresolved");
});

test("unknown and ambiguous exact terms are not auto-resolved", () => {
  assert.equal(resolveSearch(index, "not-a-real-model").resolved, null);
  const ambiguousIndex = {
    schemaVersion: 2,
    collisions: [],
    entries: [
      { entityType: "model", entityId: "brand/alpha", brandId: "brand", modelId: "brand/alpha", term: "Twin", key: "twin", kind: "canonical", safe: true, sourceIds: ["one"] },
      { entityType: "model", entityId: "brand/beta", brandId: "brand", modelId: "brand/beta", term: "Twin", key: "twin", kind: "canonical", safe: true, sourceIds: ["two"] },
    ],
  };
  const result = resolveSearch(ambiguousIndex, "Twin");
  assert.equal(result.ambiguous, true);
  assert.equal(result.resolved, null);
});

test("shared W447 and update labels stay explicitly ambiguous without model context", () => {
  assert.equal(resolveSearch(index, "W447", { make: "Mercedes-Benz" }).ambiguous, true);
  const collisionKeys = index.collisions.map((row) => row.key);
  assert(collisionKeys.includes("facelift:mercedes-benz:2023midsizerangeupdate"));
  assert(collisionKeys.includes("generation:mercedes-benz:w447"));
});
