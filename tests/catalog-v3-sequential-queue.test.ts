import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const queue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");
const removedDailyWorkingMarkets = new URL("../.github/workflows/catalog-live-daily-working-markets.yml", import.meta.url);
const removedKyrgyzstanRecovery = new URL("../.github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml", import.meta.url);

test("sequential queue keeps explicit operator triggers while automatic scheduling is paused", () => {
  assert.match(queue, /workflow_dispatch:/);
  assert.doesNotMatch(queue, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(queue, /cron: "17 21 \* \* \*"/);
  assert.match(queue, /Production collection is intentionally paused/);
  assert.match(queue, /push:[\s\S]*branches:[\s\S]*- main[\s\S]*paths:[\s\S]*\.github\/catalog-v3-run-all/);
  assert.match(queue, /github\.event_name \}\}" = "push"/);
  assert.doesNotMatch(queue, /workflow_run:/);
  assert.doesNotMatch(queue, /gh workflow run/);
});

test("superseded daily working markets writer remains deleted", () => {
  assert.equal(fs.existsSync(removedDailyWorkingMarkets), false);
});

test("Kyrgyzstan recovery and sequential jobs remain deleted", () => {
  assert.equal(fs.existsSync(removedKyrgyzstanRecovery), false);
  assert.doesNotMatch(queue, /kyrgyzstan|Кыргызстан/);
});
