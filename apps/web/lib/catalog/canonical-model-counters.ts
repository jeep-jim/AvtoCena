import type { VehicleKnowledgeModel } from "./vehicle-knowledge";
import { vehicleKnowledgeCompact } from "./vehicle-knowledge";

export type LiveModelCount = { model: string; count: number; marketCounts: Record<string, number> };

export function canonicalModelCounters(models: VehicleKnowledgeModel[], live: LiveModelCount[]) {
  const aliases = new Map<string, VehicleKnowledgeModel | null>();
  for (const model of models) {
    for (const value of [model.model, ...(model.aliases || [])]) {
      const key = vehicleKnowledgeCompact(value);
      if (!key) continue;
      const current = aliases.get(key);
      if (current && current.id !== model.id) aliases.set(key, null);
      else if (current === undefined) aliases.set(key, model);
    }
  }
  const counters = new Map<string, { count: number; marketCounts: Record<string, number> }>();
  for (const item of live) {
    const recognized = aliases.get(vehicleKnowledgeCompact(item.model));
    if (!recognized || item.count <= 0) continue;
    const entry = counters.get(recognized.id) || { count: 0, marketCounts: {} };
    entry.count += item.count;
    for (const [market, count] of Object.entries(item.marketCounts)) entry.marketCounts[market] = (entry.marketCounts[market] || 0) + count;
    counters.set(recognized.id, entry);
  }
  return counters;
}

