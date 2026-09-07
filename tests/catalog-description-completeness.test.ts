import assert from "node:assert/strict";
import test from "node:test";
import { catalogDescriptionRejectionReason } from "../apps/web/lib/catalog/description-completeness";

test("five-market publication excludes missing and placeholder descriptions", () => {
  const complete = { market: "europe" as const, bodyType: "wagon", drive: "fwd", transmission: "automatic" };
  assert.equal(catalogDescriptionRejectionReason(complete), "");
  for (const field of ["bodyType", "drive", "transmission"] as const) {
    for (const value of [undefined, "", "  ", "unknown", "уточняется"]) {
      assert.equal(catalogDescriptionRejectionReason({ ...complete, [field]: value }), `description_${field}_missing`);
    }
  }
});

test("description completeness does not invent engine or drive and leaves Japan out of this restart", () => {
  const offer = { market: "korea" as const, bodyType: "sedan", transmission: "automatic" };
  const before = structuredClone(offer);
  assert.equal(catalogDescriptionRejectionReason(offer), "description_drive_missing");
  assert.deepEqual(offer, before);
  assert.equal(catalogDescriptionRejectionReason({ market: "japan" }), "");
});
