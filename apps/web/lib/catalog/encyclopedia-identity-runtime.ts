import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { applyEncyclopediaIdentity, type IdentityApplied } from "./encyclopedia-identity-application";
import {
  assertEncyclopediaIdentityProductionConnected,
  readEncyclopediaIdentityDataset,
  readEncyclopediaIdentityResolver,
} from "./encyclopedia-identity-data";

export type CatalogEncyclopediaIdentityMode = "off" | "shadow" | "apply";

type IdentityCarrier = {
  make: string;
  model: string;
  operational?: Record<string, unknown>;
};

export function catalogEncyclopediaIdentityMode(raw = process.env.CATALOG_ENCYCLOPEDIA_IDENTITY_MODE): CatalogEncyclopediaIdentityMode {
  const mode = String(raw || "off").trim().toLowerCase();
  if (mode === "shadow" || mode === "apply") return mode;
  return "off";
}

/**
 * Mode semantics:
 * - off: zero behavior/data change and no V2 read.
 * - shadow: keep public make/model untouched, but require a valid V2 resolver
 *   and attach resolution metadata for coverage/unresolved audits.
 * - apply: requires BOTH env mode=apply and manifest.productionConnected=true.
 */
export function applyEncyclopediaIdentityForMode<T extends IdentityCarrier>(
  resolver: EncyclopediaIdentityResolver,
  input: T,
  mode: CatalogEncyclopediaIdentityMode,
): T | IdentityApplied<T> {
  if (mode === "off") return input;
  const applied = applyEncyclopediaIdentity(resolver, input);
  if (mode === "apply") return applied;
  return {
    ...input,
    operational: applied.operational,
  } as T;
}

export async function requireEncyclopediaIdentityApplyEnabled() {
  const dataset = await readEncyclopediaIdentityDataset();
  if (!dataset) throw new Error("catalog_encyclopedia_identity_dataset_unavailable:apply");
  assertEncyclopediaIdentityProductionConnected(dataset);
  return dataset;
}

export async function applyConfiguredEncyclopediaIdentity<T extends IdentityCarrier>(input: T): Promise<T | IdentityApplied<T>> {
  const mode = catalogEncyclopediaIdentityMode();
  if (mode === "off") return input;
  if (mode === "apply") await requireEncyclopediaIdentityApplyEnabled();
  const resolver = await readEncyclopediaIdentityResolver();
  if (!resolver) throw new Error(`catalog_encyclopedia_identity_dataset_unavailable:${mode}`);
  return applyEncyclopediaIdentityForMode(resolver, input, mode);
}
