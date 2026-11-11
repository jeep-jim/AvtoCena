import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { applyEncyclopediaIdentity, type IdentityApplied } from "./encyclopedia-identity-application";
import {
  assertEncyclopediaIdentityProductionConnected,
  readEncyclopediaIdentityDataset,
  readEncyclopediaIdentityResolver,
} from "./encyclopedia-identity-data";

export type CatalogEncyclopediaIdentityMode = "auto" | "off" | "shadow" | "apply";
export type EffectiveCatalogEncyclopediaIdentityMode = Exclude<CatalogEncyclopediaIdentityMode, "auto">;

type IdentityCarrier = {
  make: string;
  model: string;
  operational?: Record<string, unknown>;
};

/**
 * Default `auto` keeps activation reproducible in Git through
 * manifest.identityProductionConnected. An explicit environment value remains
 * an operational override; unknown non-empty values fail safe to `off`.
 */
export function catalogEncyclopediaIdentityMode(raw = process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_MODE): CatalogEncyclopediaIdentityMode {
  const mode = String(raw ?? "").trim().toLowerCase();
  if (!mode) return "auto";
  if (mode === "off" || mode === "shadow" || mode === "apply") return mode;
  return "off";
}

export async function requireEncyclopediaIdentityApplyEnabled() {
  const dataset = await readEncyclopediaIdentityDataset();
  if (!dataset) throw new Error("catalog_encyclopedia_identity_dataset_unavailable:apply");
  assertEncyclopediaIdentityProductionConnected(dataset);
  return dataset;
}

export async function effectiveCatalogEncyclopediaIdentityMode(
  raw = process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_MODE,
): Promise<EffectiveCatalogEncyclopediaIdentityMode> {
  const configured = catalogEncyclopediaIdentityMode(raw);
  if (configured === "off" || configured === "shadow") return configured;
  if (configured === "apply") {
    await requireEncyclopediaIdentityApplyEnabled();
    return "apply";
  }
  const dataset = await readEncyclopediaIdentityDataset();
  if (!dataset) return "off";
  return dataset.manifest.identityProductionConnected === true ? "apply" : "off";
}

/**
 * Mode semantics:
 * - off: zero behavior/data change.
 * - shadow: keep public make/model untouched and attach audit metadata.
 * - apply: canonicalize only proven brand/model identity.
 *
 * This pure function never accepts `auto`; callers resolve it first.
 */
export function applyEncyclopediaIdentityForMode<T extends IdentityCarrier>(
  resolver: EncyclopediaIdentityResolver,
  input: T,
  mode: EffectiveCatalogEncyclopediaIdentityMode,
): T | IdentityApplied<T> {
  if (mode === "off") return input;
  const applied = applyEncyclopediaIdentity(resolver, input);
  if (mode === "apply") return applied;
  return {
    ...input,
    operational: applied.operational,
  } as T;
}

export async function applyConfiguredEncyclopediaIdentity<T extends IdentityCarrier>(input: T): Promise<T | IdentityApplied<T>> {
  const mode = await effectiveCatalogEncyclopediaIdentityMode();
  if (mode === "off") return input;
  const resolver = await readEncyclopediaIdentityResolver();
  if (!resolver) throw new Error(`catalog_encyclopedia_identity_dataset_unavailable:${mode}`);
  return applyEncyclopediaIdentityForMode(resolver, input, mode);
}
