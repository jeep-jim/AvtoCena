import assert from "node:assert/strict";
import test from "node:test";

import {
  looksLikeDromSpecsDocument,
  parseDromVehicleVariantsV2,
} from "../apps/web/lib/catalog/drom-vehicle-knowledge-v2";

const model = {
  id: "toyota/corolla",
  make: "Toyota",
  model: "Corolla",
  active: true,
} as any;

const currentDromText = `
# Объем двигателя Тойота Королла, технические характеристики
### Двигатель Toyota Corolla рестайлинг 2022, седан, 12 поколение, E210
10.2022 - н.в.
Модификации | Объем двигателя, см³ | Марка двигателя
1.5 л, 120 л.с., бензин, вариатор (CVT), передний привод | 1490 | M15A-FKS
1.8 л, 98 л.с., бензин, вариатор (CVT), полный привод (4WD), гибрид | 1797 | 2ZR-FXE
`;

test("recognizes current Drom specs document", () => {
  assert.equal(looksLikeDromSpecsDocument(currentDromText), true);
});

test("parses current Drom markdown/table rows", () => {
  const variants = parseDromVehicleVariantsV2(
    currentDromText,
    model,
    "https://www.drom.ru/catalog/toyota/corolla/specs/engine_capacity/",
    "2026-08-05T00:00:00.000Z",
  );

  assert.equal(variants.length, 2);
  assert.deepEqual(
    variants.map((row) => ({
      hp: row.powerHp,
      cc: row.engineCc,
      fuel: row.fuel,
      transmission: row.transmission,
      drive: row.drive,
      generation: row.generation,
      yearFrom: row.yearFrom,
      engineCode: row.engineCode,
    })),
    [
      {
        hp: 120,
        cc: 1490,
        fuel: "petrol",
        transmission: "cvt",
        drive: "fwd",
        generation: "12 поколение, рестайлинг",
        yearFrom: 2022,
        engineCode: "M15A-FKS",
      },
      {
        hp: 98,
        cc: 1797,
        fuel: "hybrid",
        transmission: "cvt",
        drive: "awd",
        generation: "12 поколение, рестайлинг",
        yearFrom: 2022,
        engineCode: "2ZR-FXE",
      },
    ],
  );
});

test("does not treat challenge page as valid specs", () => {
  assert.equal(looksLikeDromSpecsDocument("Проверка браузера. Подтвердите, что вы не робот."), false);
});
