import { selectActiveMarketVersion } from './business-settings';
import { resolveEffectiveMarketVersion } from './effective-market-settings';
import { MARKET_IDS, validateMarketVersion } from './settings-validation';

export const MARKET_COSTS_MIGRATION = 'service_bundle_20260916';

/** One versioned change, preserving unrelated tariffs and all previous snapshots.
 * Later CRM edits carry serviceBundleVersion, so deployment never resets them. */
export function migrateMarketCosts(markets: any[], at: string) {
  const changed: {marketId: string; oldValue: any; newValue: any}[] = [];
  const next = [...markets];
  for (const marketId of MARKET_IDS) {
    const index = next.findIndex(market => market.id === marketId);
    const market = index < 0 ? {id: marketId, versions: []} : next[index];
    const current = selectActiveMarketVersion(market, new Date(at));
    if (current?.serviceBundleVersion >= 1) continue;
    if ((market.versions || []).some((v:any) => v.active !== false && v.status === 'scheduled' && !v.serviceBundleVersion)) {
      throw new Error(`market_costs_scheduled_legacy_version:${marketId}`);
    }
    const effective = resolveEffectiveMarketVersion(marketId, current);
    const version = Math.max(0, ...(market.versions || []).map((v:any) => Number(v.version || 0))) + 1;
    const candidate = {...effective, id: `market_${marketId}_${MARKET_COSTS_MIGRATION}`, version,
      effectiveFrom: at, createdAt: at, createdByUserId: 'system:owner-request-20260916',
      migrationId: MARKET_COSTS_MIGRATION, serviceBundleVersion: 1,
      securityDepositRub: marketId === 'japan' ? 31_000 : 160_000,
      topAvtoCommissionRub: marketId === 'japan' ? 39_000 : 90_000,
      contractInitialPaymentRub: marketId === 'japan' ? 70_000 : 250_000,
      laboratoryRub: 50_000, sbktsRub: 0, eptsRub: 0};
    candidate.dealStages = (effective.dealStages || []).map((stage:any) => {
      if (stage.title === 'Договор') return {...stage, amount:candidate.contractInitialPaymentRub,
        description:'Первый платёж по договору.'};
      if (stage.title === 'Документы и доставка') return {...stage,
        amount:Number(candidate.brokerRub || 0) + Number(candidate.svhRub || 0) + candidate.laboratoryRub + Number(candidate.rfDeliveryRub || 0)};
      return stage;
    });
    const validated = validateMarketVersion(candidate);
    if (!validated.ok) throw new Error(`market_costs_invalid:${marketId}:${validated.errors.join(',')}`);
    const updated = {...market, name: market.name || effective.name || marketId, activeVersionId: candidate.id,
      versions: [...(market.versions || []).map((v:any) => v.id === current?.id ? {...v, status:'archived'} : v), validated.value]};
    if (index < 0) next.push(updated); else next[index] = updated;
    changed.push({marketId, oldValue: current, newValue: validated.value});
  }
  return {markets: next, changed};
}
