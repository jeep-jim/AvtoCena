import assert from "node:assert/strict";
import test from "node:test";
import { catalogImportSources } from "../apps/web/lib/catalog/importer";
import {
  auctionDataSearchRestrictedSource,
  dongchediRestrictedSource,
  jpCenterRestrictedSource,
} from "../apps/web/lib/catalog/restricted-required-sources";

const expected = [
  [dongchediRestrictedSource, "dongchedi_public_inventory_requires_login_or_permitted_partner_feed"],
  [auctionDataSearchRestrictedSource, "auctiondatasearch_search_and_statistics_require_login_or_permitted_partner_feed"],
  [jpCenterRestrictedSource, "jpcenter_exact_vehicle_price_and_full_gallery_require_login_or_permitted_partner_feed"],
] as const;

test("access-constrained required sources fail closed instead of reporting a successful empty page", async () => {
  for (const [source, reason] of expected) {
    assert.equal(source.accessMode, "partner_feed");
    assert.equal(catalogImportSources.find((candidate) => candidate.sourceId === source.sourceId), source);

    const health = await source.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.blocked, true);
    assert.equal(health.message, reason);

    await assert.rejects(
      () => source.fetchPage(),
      (error: unknown) => {
        const blocked = error as Error & { blocked?: boolean; status?: number };
        assert.equal(blocked.message, reason);
        assert.equal(blocked.blocked, true);
        assert.equal(blocked.status, 200);
        return true;
      },
    );
  }
});

test("restricted adapters cannot manufacture candidates or galleries from public shell pages", async () => {
  for (const [source] of expected) {
    assert.equal(source.normalizeOffer({ title: "Toyota", averagePrice: 5_000_000 }), null);
    assert.deepEqual(await source.fetchImages({} as never), []);
  }
});
