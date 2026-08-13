import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const recoveryPublisher = fs.readFileSync(new URL("../scripts/catalog-live-recovery-publish-batch.mjs", import.meta.url), "utf8");

test("recovery publisher honors a target-market minimum image depth", () => {
  assert.match(recoveryPublisher, /RECOVERY_MIN_IMAGES_PER_OFFER|CATALOG_REBUILD_MIN_IMAGES_PER_OFFER/);
  assert.match(recoveryPublisher, /images_below_minimum|hasRecoveryImageDepth/);
});
