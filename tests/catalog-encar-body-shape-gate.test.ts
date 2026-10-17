import test from "node:test";
import assert from "node:assert/strict";
import { extractEncarExactBodyType } from "../apps/web/lib/catalog/encar-complete-source";

test("Encar body shape ignores generic carType classification", () => {
  const body = extractEncarExactBodyType({
    metadata: { carType: "suv" },
    categories: [{ carType: "SUV" }],
  });
  assert.equal(body, "");
});

test("Encar body shape accepts an explicitly body-named detail field", () => {
  const body = extractEncarExactBodyType({
    metadata: { carType: "suv" },
    specifications: { bodyType: "sedan" },
  });
  assert.equal(body, "sedan");
});
