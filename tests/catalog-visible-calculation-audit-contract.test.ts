import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const audit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");
const publicPriority = fs.readFileSync(new URL("../apps/web/lib/catalog/public-priority.ts", import.meta.url), "utf8");

test("visible calculation audit accepts safely hidden estimated inventory without weakening price safety", () => {
  assert.match(audit, /catalogOfferVisibleRub\(offer\)/);
  assert.match(audit, /const safelyHiddenEstimated = status === "estimated" && visibleRub === 0 && identityResolved;/);
  assert.match(audit, /if \(safelyHiddenEstimated\) \{[\s\S]*increment\(needsDataModels/);
  assert.match(audit, /pass: invalidReady\.length === 0 && allIdentitiesResolved && unsafePendingVisiblePrices\.length === 0/);
  assert.match(publicPriority, /if \(catalogRequiredSpecificationRejectionReason\(offer\)\) return 0;/);
});
