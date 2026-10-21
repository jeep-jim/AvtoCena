import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadWorkspace, readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DATA_ROOT = path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2");

test("Wuling Asta 2021 keeps one English identity and all five official ICE grades", async () => {
  const [workspace, report] = await Promise.all([
    loadWorkspace(DATA_ROOT),
    readJson(path.join(DATA_ROOT, "reports/wuling-asta-ice-2021-lineup.json")),
  ]);
  const model = workspace.records.model.find((record) => record.id === "wuling/xingchen");
  const variants = workspace.records.variant.filter((record) => record.generationId === "wuling/xingchen/ice-launch-2021");

  assert.deepEqual(report.totals, { newSources: 2, newGenerations: 1, newVariants: 5 });
  assert.equal(model?.canonicalName, "Asta");
  assert.deepEqual(variants.map((variant) => variant.name).sort(), [
    "1.5T CVT Star Glory",
    "1.5T CVT Star Ray",
    "1.5T CVT Star Shine",
    "1.5T MT Dynamic",
    "1.5T MT Starlight",
  ]);

  for (const variant of variants) {
    assert.deepEqual(
      [variant.market, variant.yearFrom, variant.bodyType, variant.powertrainKind, variant.lengthMm, variant.widthMm, variant.heightMm, variant.wheelbaseMm, variant.seats],
      ["China", 2021, "SUV", "ICE", 4594, 1820, 1740, 2750, 5],
    );
    assert(variant.aliases.some((item) => item.language === "zh-CN" && item.safe));
    assert(["Manual", "CVT"].includes(variant.transmission));
    assert.equal("engineCc" in variant, false);
    assert.equal("powerKw" in variant, false);
    assert.equal("power30MinKw" in variant, false);
    assert.equal("powerHp" in variant, false);
    assert.equal(variant.status, "review");
  }
});
