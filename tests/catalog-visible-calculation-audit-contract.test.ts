import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const audit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");
const publicPriority = fs.readFileSync(new URL("../apps/web/lib/catalog/public-priority.ts", import.meta.url), "utf8");

test("visible calculation audit accepts safely hidden estimated inventory without weakening price safety", () => {
  assert.match(audit, /specificationRejection = catalogRequiredSpecificationRejectionReason\(offer\)/);
  assert.match(audit, /if \(specificationRejection\) return \{/);
  assert.doesNotMatch(audit, /scenario\?\.requiresConfirmation === true \|\| \/\^power_scenario:\//);
  assert.match(audit, /catalogOfferVisibleRub\(offer\)/);
  assert.match(audit, /const safelyHiddenEstimated = status === "estimated" && visibleRub === 0 && identityResolved;/);
  assert.match(audit, /if \(safelyHiddenEstimated\) \{[\s\S]*increment\(needsDataModels/);
  assert.match(audit, /pass: invalidReady\.length === 0[\s\S]*allIdentitiesResolved[\s\S]*unsafePendingVisiblePrices\.length === 0/);
  assert.match(audit, /fallback100PublicCount/);
  assert.match(audit, /unprovenExact100PublicCount/);
  assert.match(audit, /noFallback100PublicCards/);
  assert.match(publicPriority, /if \(catalogRequiredSpecificationRejectionReason\(offer\)\) return 0;/);
});
