import { carswitchUaeExactSource } from "./carswitch-exact-source";
import { dubicarsUaeCurrentSource } from "./dubicars-current-source";
import { kcarKoreaExactSource } from "./kcar-exact-source";
import type { SavedDetailNeed } from "./saved-detail-recovery";
import type { CatalogSourceAdapter, VehicleOffer } from "./types";

type FixedIdAdapter = CatalogSourceAdapter & Required<Pick<CatalogSourceAdapter, "refreshOffer">>;

const DIRECT_FIXED_ID_ADAPTERS: Readonly<Record<string, FixedIdAdapter>> = {
  carswitch_uae_open: carswitchUaeExactSource as FixedIdAdapter,
  dubicars_uae_exact: dubicarsUaeCurrentSource as FixedIdAdapter,
  kcar_korea_open: kcarKoreaExactSource as FixedIdAdapter,
};

export function directFixedIdRecoveryRegistered(sourceId: unknown) {
  return Boolean(DIRECT_FIXED_ID_ADAPTERS[String(sourceId || "")]);
}

const RECOVERED_FIELDS: Readonly<Record<SavedDetailNeed, readonly (keyof VehicleOffer)[]>> = {
  sourcePrice: ["sourcePrice", "sourceCurrency", "priceMode"],
  photos: ["images"],
  fuelPowertrain: ["fuel", "powertrainKind"],
  engineCc: ["engineCc"],
  powerHp: ["powerHp", "powerKw", "icePowerKw", "utilizationPowerKw", "powerDataConfidence", "powerDataSource"],
  certifiedPower: ["power30MinKw", "power30MinKwByMotor", "utilizationPowerKw", "powerDataConfidence", "powerDataSource"],
};

/**
 * Calls exactly one adapter's identity-bound detail refresh; no list fallback.
 * The raw parser result is projected onto the requested field set before it
 * reaches the validator, so a detail-page drift cannot become a broad refresh.
 */
export async function recoverSavedDetailCandidate(offer: VehicleOffer, requestedNeeds: readonly SavedDetailNeed[]) {
  const adapter = DIRECT_FIXED_ID_ADAPTERS[offer.sourceId];
  if (!adapter || adapter.market !== offer.market) throw new Error(`targeted_detail_direct_handler_missing:${offer.sourceId}`);
  const raw = await adapter.refreshOffer(structuredClone(offer));
  const projected = structuredClone(offer);
  for (const field of new Set(requestedNeeds.flatMap((need) => RECOVERED_FIELDS[need] || []))) {
    (projected as any)[field] = structuredClone((raw as any)[field]);
  }
  projected.operational = structuredClone(raw.operational);
  projected.updatedAt = raw.updatedAt;
  return projected;
}
