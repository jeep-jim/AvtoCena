import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/catalog-production-recovery-v15.yml", import.meta.url), "utf8");

test("probe does not bypass customs and publication validation", () => {
  const probe = workflow.indexOf("Probe curated live sources");
  const rebuild = workflow.indexOf("Rebuild only sources that passed probe");
  const gate = workflow.indexOf("Require fresh offers, exact customs and valid galleries");
  const publish = workflow.indexOf("Publish verified fresh catalog");
  assert.ok(probe >= 0 && rebuild > probe);
  assert.ok(gate > rebuild && publish > gate);
  assert.doesNotMatch(workflow, /Require fresh offers, exact customs and valid galleries\n\s+continue-on-error: true/);
});
