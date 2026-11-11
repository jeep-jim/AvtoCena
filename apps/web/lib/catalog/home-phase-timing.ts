import type {CatalogMarket} from "./types";
import { randomUUID } from "node:crypto";

type HomePhase = "dealer" | "snapshot" | "counts" | "green" | "greenPricing" | "catalogPricing" | "dealerRail" | "japanRail" | "snapshotContext" | "snapshotBody" | "snapshotPrepared" | "snapshotManifest" | "snapshotOverview" | "snapshotProjection" | `snapshotEditorial:${CatalogMarket}`;
export function createHomePhaseTiming() {
  const enabled = process.env.CATALOG_HOME_PHASE_TIMING === "1";
  const trace = enabled ? randomUUID() : "";
  let generation: string | undefined;
  const day = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  return {
    setGeneration(value: unknown) {
      if (enabled && typeof value === "string" && /^gen_[0-9]+_[a-z0-9-]{1,80}$/.test(value)) generation = value;
    },
    async measure<T>(phase: HomePhase, work: () => Promise<T>): Promise<T> {
      if (!enabled) return work();
      const started = performance.now(), policyDate = day();
      let ok = false;
      try { const value = await work(); ok = true; return value; }
      finally {
        // Diagnostics must never change the result or expose records/error text.
        try { console.info("home_phase", JSON.stringify({trace, phase, ms: Math.round((performance.now()-started)*10)/10,
          ok, policyDate, completedPolicyDate: day(), ...(generation ? {generation} : {})})); } catch {}
      }
    },
  };
}
