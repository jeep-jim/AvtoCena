import assert from "node:assert/strict";
import test from "node:test";
import { enrichOfferForDisplay } from "../apps/web/lib/catalog/display-enrichment";

test("fills known BMW i3 eDrive display fields instead of showing unresolved placeholders", async () => {
  const offer = {
    id: "bmw-i3-edrive-40l",
    sourceId: "dubicars_uae_exact",
    sourceOfferId: "bmw-1",
    market: "uae",
    offerType: "fixed",
    status: "active",
    make: "BMW",
    model: "i3 eDrive 40L",
    trim: "Law Mileage (32,000 Km) 340 Hp",
    year: 2023,
    mileageKm: 32_000,
    powerHp: 340,
    powertrainKind: "unknown",
    sourcePrice: 120_000,
    sourceCurrency: "AED",
    images: [],
    totalRub: 3_172_025,
    firstSeenAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    operational: {
      sourceUrl: "https://example.com/bmw-i3",
      raw: { title: "BMW i3 eDrive 40L Law Mileage 32,000 Km 340 Hp" },
    },
  } as any;

  const enriched = await enrichOfferForDisplay(offer);

  assert.equal(enriched.powertrainKind, "electric");
  assert.equal(enriched.fuel, "electric");
  assert.equal(enriched.transmission, "automatic");
  assert.equal(enriched.drive, "rwd");
  assert.equal(enriched.engineCc, undefined);
});
