import test from "node:test";
import assert from "node:assert/strict";
import { parseDromVehicleVariants } from "../apps/web/lib/catalog/drom-vehicle-knowledge";
import type { VehicleKnowledgeModel } from "../apps/web/lib/catalog/vehicle-knowledge";

const model: VehicleKnowledgeModel = {
  id: "honda/hr-v",
  make: "Honda",
  model: "HR-V",
  aliases: ["HRV"],
  source: "manual",
  updatedAt: "2026-07-25T00:00:00.000Z",
  active: true,
};

const html = `
  <h3>Двигатель Honda HR-V 2022, джип/suv 5 дв., 3 поколение, RZ</h3>
  <p>04.2022 - н.в.</p>
  <table>
    <tr><th>Модификации</th><th>Объем двигателя, см³</th><th>Марка двигателя</th></tr>
    <tr><td>2.0 л, 158 л.с., бензин, вариатор (CVT), полный привод (4WD)</td><td>1996</td><td>K20C2</td></tr>
    <tr><td>2.0 л, 158 л.с., бензин, вариатор (CVT), передний привод</td><td>1996</td><td>K20C2</td></tr>
  </table>
  <h3>Двигатель Honda HR-V рестайлинг 2024, джип/suv 5 дв., 3 поколение, RV</h3>
  <p>03.2024 - н.в.</p>
  <table>
    <tr><td>1.5 л, 107 л.с., бензин, вариатор (CVT), передний привод, гибрид</td><td>1496</td><td>LEC</td></tr>
  </table>
`;

test("parses Drom engine rows into distinct canonical variants", () => {
  const variants = parseDromVehicleVariants(html, model, "https://www.drom.ru/catalog/honda/hr-v/specs/engine_capacity/", "2026-07-25T00:00:00.000Z");
  assert.equal(variants.length, 3);

  const awd = variants.find((variant) => variant.powerHp === 158 && variant.drive === "awd");
  assert.ok(awd);
  assert.equal(awd.engineCc, 1996);
  assert.equal(awd.transmission, "cvt");
  assert.equal(awd.powertrainKind, "combustion");
  assert.equal(awd.yearFrom, 2022);
  assert.equal(awd.engineCode, "K20C2");

  const hybrid = variants.find((variant) => variant.powerHp === 107);
  assert.ok(hybrid);
  assert.equal(hybrid.engineCc, 1496);
  assert.equal(hybrid.fuel, "hybrid");
  assert.equal(hybrid.powertrainKind, "other_hybrid");
  assert.equal(hybrid.generation, "3 поколение, рестайлинг");
});
