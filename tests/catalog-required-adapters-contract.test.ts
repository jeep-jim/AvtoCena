import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import { REQUIRED_CATALOG_SOURCES } from "../apps/web/lib/catalog/required-catalog-sources";

const probeScript = fs.readFileSync(new URL("../scripts/catalog-probe-source-shard.mjs", import.meta.url), "utf8");

test("every mandatory source has a registered parser adapter", () => {
  const adapterIds = new Set(catalogImportSources.map((source) => source.sourceId));
  for (const [market, sources] of Object.entries(REQUIRED_CATALOG_SOURCES)) {
    for (const source of sources) {
      assert.ok(adapterIds.has(source.sourceId), `${market}:${source.sourceId} has no parser adapter`);
    }
  }
});

test("market probes derive mandatory sites from the canonical contract", () => {
  assert.match(probeScript, /requiredCatalogSourceIds/);
  assert.match(probeScript, /requiredSourceIds/);
  assert.match(probeScript, /requiredComplete/);
  assert.match(probeScript, /CATALOG_PROBE_ALLOW_REQUIRED_SUBSET/);
  assert.doesNotMatch(probeScript, /const priorityPlan =/);
});
