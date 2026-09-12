import type { VehicleOffer } from './types';
import { sourceInventoryInScope } from './source-inventory-scope';
import { selectCatalogPowerMix } from './power-mix';

const AUTOHOME = 'autohome_new_china_open';

/** Cap actual public rows, including retained inventory; never delete raw data. */
export function selectChinaSourceShare<T extends Partial<VehicleOffer>>(rows: readonly T[]) {
  const china = rows.filter(row => row.market === 'china');
  const other = china.filter(row => row.sourceId !== AUTOHOME).length;
  // A / (A + other) <= 0.10, hence A <= floor(other / 9).
  const allowance = Math.floor(other / 9);
  let kept = 0;
  const removed: T[] = [];
  const selected = rows.filter(row => {
    if (row.market !== 'china' || row.sourceId !== AUTOHOME) return true;
    if (!sourceInventoryInScope(row) || kept >= allowance) { removed.push(row); return false; }
    kept++;
    return true;
  });
  return { rows: selected, removed, report: { china: {
    autohome: kept, otherSources: other, published: other + kept,
    maxShare: 0.1, actualShare: other + kept ? kept / (other + kept) : 0,
    held: removed.length, allowance,
  } } };
}

/** Both quotas must hold after all removals, not just before canonicalization. */
export function selectCatalogPublicationMix<T extends Partial<VehicleOffer>>(rows: readonly T[], enforcePower: boolean) {
  let current = [...rows];
  const sourceRemoved: T[] = [], powerRemoved: T[] = [];
  while (true) {
    const source = selectChinaSourceShare(current);
    sourceRemoved.push(...source.removed);
    const power = enforcePower ? selectCatalogPowerMix(source.rows)
      : { rows: source.rows, removed: [] as T[], report: {} };
    powerRemoved.push(...power.removed);
    const finalSource = selectChinaSourceShare(power.rows);
    if (!finalSource.removed.length) {
      for (const [market, value] of Object.entries(power.report)) {
        const report = value as Record<string, unknown>;
        report.held = powerRemoved.filter(row => row.market === market).length;
      }
      return { rows: power.rows,
        sourceShare: { ...finalSource, removed: sourceRemoved,
          report: { china: { ...finalSource.report.china, held: sourceRemoved.length } } },
        powerMix: { ...power, removed: powerRemoved } };
    }
    // Each repeat strictly removes rows, so no oscillation or replenishment.
    current = power.rows;
  }
}
