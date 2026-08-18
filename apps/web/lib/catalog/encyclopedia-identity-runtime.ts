import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { applyEncyclopediaIdentity, type IdentityApplied } from "./encyclopedia-identity-application";
import { readEncyclopediaIdentityResolver } from "./encyclopedia-identity-data";

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
 * - off: zero behavior/data change.
 * - shadow: keep public make/model untouched, but attach resolution metadata to
 *   operational data so coverage/unresolved queues can be audited.
 * - apply: use only the resolver's proven canonical make/model while retaining
 *   original source spelling in operational metadata.
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

export async function applyConfiguredEncyclopediaIdentity<T extends IdentityCarrier>(input: T): Promise<T | IdentityApplied<T>> {
  const mode = catalogEncyclopediaIdentityMode();
  if (mode === "off") return input;
  const resolver = await readEncyclopediaIdentityResolver();
  if (!resolver) return input;
  return applyEncyclopediaIdentityForMode(resolver, input, mode);
}
