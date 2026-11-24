import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {applyCatalogEditorial, editorialHidden} from '../../apps/web/lib/catalog/editorial.ts';
import {applyEncyclopediaCalculation} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {specificationEvidenceComplete} from '../../apps/web/lib/catalog/modification-matching.ts';
import {calculateOfferWithVerifiedSpecifications} from '../../apps/web/lib/catalog/customs-pricing.ts';
import {applyActiveBusinessPriceBatch} from '../../apps/web/lib/catalog/live-business-pricing.ts';
import {catalogOfferVisibleRub} from '../../apps/web/lib/catalog/public-priority.ts';
import {catalogInventoryAgeDecision, catalogInventoryDate, catalogVehicleExcluded} from '../../apps/web/lib/catalog/inventory-admission.ts';
import {isConfirmedSourceWithdrawn} from '../../apps/web/lib/catalog/confirmed-source-withdrawals.ts';
import {isReviewedSourceDuplicate} from '../../apps/web/lib/catalog/reviewed-source-duplicates.ts';
import {publicationWithdrawn} from '../../apps/web/lib/catalog/publication-policy.ts';
import {safePublicPricing} from '../../apps/web/lib/catalog/safe-public-pricing.ts';
import {searchProjectionFromOffer, compactPublicStorageOffer} from '../../apps/web/lib/catalog/storage.ts';
import {priceCardForCity, deliveryPricingBasis} from '../../apps/web/lib/catalog/card-city-delivery.ts';
import {quoteCityDelivery} from '../../apps/web/lib/catalog/city-delivery.ts';
import {businessPaymentPlan} from '../../packages/engine/src/calculation/calculateAvtocena.ts';
import {calculatedCatalogPrice} from '../../apps/web/lib/catalog/calculated-price.ts';
import {catalogDisplayGroup, catalogDisplayPrice} from '../../apps/web/lib/catalog/display-order.ts';
import {catalogPowerBand} from '../../apps/web/lib/catalog/power-mix.ts';

const need = (value, reason) => assert(value, 'china_pricing_' + reason);
export const pricingDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Every original row reaches editorial and the compiled encyclopedia before
 * a market policy decision. Missing price, make/model or photo is not a sale. */
export function enrichAndAdmitChinaOffer(input, {editorial, encyclopedia, pricingAsOf}) {
  need(input?.market === 'china' && input.sourceId === 'autohome_used_china_open' &&
    typeof input.sourceOfferId === 'string' && /^\d{1,32}$/.test(input.sourceOfferId) &&
    input.id === createHash('sha256').update(input.sourceId + ':' + input.sourceOfferId).digest('hex').slice(0, 24), 'source_identity');
  const edited = applyCatalogEditorial(input, editorial), enriched = applyEncyclopediaCalculation(edited, encyclopedia);
  let reason = null;
  if (input.status !== 'active' || isConfirmedSourceWithdrawn(enriched)) reason = 'source_withdrawn';
  else if (publicationWithdrawn(enriched)) reason = 'publication_withdrawn';
  else if (editorialHidden(enriched, editorial)) reason = 'editorial_hidden';
  else if (isReviewedSourceDuplicate(enriched)) reason = 'reviewed_duplicate';
  else if (!Number.isInteger(enriched.year) || enriched.year < 1886) reason = 'year_unknown';
  else if (enriched.year < 2014) reason = 'year_before_minimum';
  else if (!catalogInventoryAgeDecision(enriched, new Date(pricingAsOf)).eligible)
    reason = enriched.year > new Date(pricingAsOf).getUTCFullYear() ? 'year_future' : 'source_date_future';
  else if (catalogVehicleExcluded(enriched)) reason = 'vehicle_excluded';
  return {offer: enriched, reason, editorialApplied: edited !== input, encyclopediaApplied: enriched !== edited};
}

/** Delete previously derived prices before a new frozen batch. Saved source
 * attributes, manual inputs and their attestation remain unchanged. */
export async function prepareChinaCalculation(offer) {
  const input = {...offer, deliveryCity: undefined, totalRub: null, previousTotalRub: null, priceDeltaRub: null,
    publicVisibleRub: undefined, publicSpecificationVerified: false, sellerPriceRub: undefined,
    savedCalculationPreview: undefined, deliveredCalculationPreview: undefined, japanDeliveredPreview: undefined,
    calculationSnapshot: undefined, calculationStatus: 'needs_data'};
  if (!specificationEvidenceComplete(input)) return {...input, catalogPricingMode: 'seller'};
  const result = await calculateOfferWithVerifiedSpecifications({...input, catalogPricingMode: undefined,
    modificationSelection: undefined, recoveryQualification: undefined});
  return result;
}

function assertFrozenRate(rate, fx) {
  if (!rate) return;
  const expected = fx.receipt.rates[rate.currency];
  need(expected && ['currency', 'cbrRate', 'nominal', 'effectiveRate', 'rateDate', 'rateSource']
    .every(key => rate[key] === expected[key]), 'unsealed_rate');
}

/** Calls the unchanged verified/business pricing path only inside the caller's
 * issued frozen-FX scope. Full private ledgers are retained for offline cities. */
export async function freezeChinaPriceBatch(inputs, fx) {
  const results = await applyActiveBusinessPriceBatch(inputs, {readOnly: true, retainFullSnapshot: true});
  need(results.length === inputs.length, 'batch_count');
  return results.map((value, index) => {
    need(value.id === inputs[index].id && value.market === 'china' && value.updatedAt === inputs[index].updatedAt, 'batch_identity');
    let offer = safePublicPricing(value);
    const snapshot = offer.calculationSnapshot || {};
    for (const key of ['currencyRate', 'customsCurrencyRate', 'eurRate']) assertFrozenRate(snapshot[key], fx);
    const visible = catalogOfferVisibleRub(offer);
    if (visible > 0) {
      need(Number.isSafeInteger(visible) && visible === offer.totalRub && Array.isArray(snapshot.breakdown) &&
        snapshot.breakdown.reduce((sum, line) => sum + line.amountRub, 0) === visible, 'full_ledger');
      need(snapshot.customs?.status === 'ready' && snapshot.priceIncludesAllCustoms !== false &&
        snapshot.priceIncludesUtilizationFee !== false && !snapshot.missing?.length, 'incomplete_price');
      offer = {...offer, catalogPricingMode: undefined, sellerPriceRub: undefined,
        publicVisibleRub: visible, publicSpecificationVerified: true, previousTotalRub: null, priceDeltaRub: null};
    } else {
      const rate = snapshot.currencyRate, seller = positive(rate?.sourcePriceRub) ? Math.round(rate.sourcePriceRub) : null;
      offer = {...offer, totalRub: null, previousTotalRub: null, priceDeltaRub: null, publicVisibleRub: undefined,
        publicSpecificationVerified: false, catalogPricingMode: 'seller', sellerPriceRub: seller ?? undefined,
        calculationStatus: offer.calculationStatus || 'needs_data'};
    }
    // Raw supplier responses and personal identifiers remain in the private
    // source generation; normal detail reads need the normalized evidence only.
    const {vin: _vin, frameNumber: _frame, ...full} = compactPublicStorageOffer(offer);
    if (full.operational) {
      const {vin: _opVin, frameNumber: _opFrame, ...operational} = full.operational;
      full.operational = operational;
    }
    const projection = searchProjectionFromOffer(full);
    need(projection.id === full.id && (projection.totalRub ?? null) === (full.totalRub ?? null), 'projection_price');
    return {full, projection, priceState: projection.totalRub ? 'priced' : positive(projection.sellerPriceRub) ? 'seller_only' : 'unpriced'};
  });
}

/** Same saved-basis city delta as prepared-china-fixed-city, also supporting
 * its valid zero-cost origin and an unquoted city. No rate or source lookup. */
export function preparedChinaCityPatch(full, projection, destination) {
  const quote = quoteCityDelivery(destination, 'china');
  const rub = calculatedCatalogPrice(projection);
  if (!(rub > 0)) return {offer: {totalRub: null, publicVisibleRub: null, previousTotalRub: null, priceDeltaRub: null,
    deliveryCity: quote.city}, snapshot: {deliveryQuote: quote}, breakdownPatch: null};
  const base = deliveryPricingBasis(full.calculationSnapshot), projectionBase = deliveryPricingBasis(projection.calculationSnapshot);
  const snapshot = full.calculationSnapshot, lines = snapshot?.breakdown, config = snapshot?.marketConfig;
  need(base && same(base, projectionBase) && Number.isSafeInteger(base.subtotalRub) && base.subtotalRub > 0 &&
    Number.isSafeInteger(base.deliveryRub) && base.deliveryRub >= 0 && Array.isArray(lines) && config && full.totalRub === projection.totalRub &&
    lines.reduce((sum, line) => sum + line.amountRub, 0) === full.totalRub, 'city_basis');
  const nextDelivery = quote.status === 'estimated' ? quote.amountRub : 0;
  const nextCard = priceCardForCity(projection, destination).offer, target = nextCard.totalRub;
  need(Number.isSafeInteger(nextDelivery) && nextDelivery >= 0 && Number.isSafeInteger(target) && target > 0, 'city_total');
  const byId = new Map(lines.map(line => [line.id, line]));
  need(byId.size === lines.length && (byId.get('rf-delivery')?.amountRub ?? 0) === base.deliveryRub, 'city_ledger');
  const percent = config.percentExpenses || [], reserved = new Set(['car', 'contract-services', 'topavto-commission', 'logistics',
    'broker', 'svh', 'laboratory', 'rf-delivery', 'customs', 'utilization-fee', 'other-fixed', 'bank-transfer', 'exchange-reserve']);
  need(new Set(percent.map(row => row.id)).size === percent.length && !percent.some(row => reserved.has(row.id)), 'city_percent_ids');
  const subtotalRub = base.subtotalRub + nextDelivery - base.deliveryRub;
  const nextPercents = percent.map(row => {
    const ratio = Number(row.percent), old = byId.get(row.id);
    need(Number.isFinite(ratio) && ratio >= 0 && (old?.amountRub ?? 0) === Math.round(base.subtotalRub * ratio / 100) &&
      (!old || old.amountType === 'percent'), 'city_percent_basis');
    return {id: row.id, title: row.title, kind: 'other', amountType: 'percent', source: 'market_config',
      note: `${row.percent}%`, amountRub: Math.round(subtotalRub * ratio / 100)};
  }).filter(row => row.amountRub > 0);
  const percentIds = new Set(percent.map(row => row.id));
  need(!lines.some(line => line.amountType === 'percent' && !percentIds.has(line.id) &&
    !['bank-transfer', 'exchange-reserve'].includes(line.id)), 'city_percent_scope');
  const fixed = lines.filter(line => line.id !== 'rf-delivery' && !percentIds.has(line.id) && !['bank-transfer', 'exchange-reserve'].includes(line.id));
  const at = fixed.findIndex(line => ['customs', 'utilization-fee', 'other-fixed'].includes(line.id));
  fixed.splice(at < 0 ? fixed.length : at, 0, {id: 'rf-delivery', title: quote.city ? `Доставка по РФ: ${quote.city}` : 'Доставка по РФ',
    amountRub: nextDelivery, kind: 'logistics', amountType: 'fixed', source: 'manager'});
  const delivered = [...fixed, ...nextPercents, ...lines.filter(line => ['bank-transfer', 'exchange-reserve'].includes(line.id))];
  need(delivered.reduce((sum, line) => sum + line.amountRub, 0) === target && new Set(delivered.map(line => line.id)).size === delivered.length,
    'city_ledger_total');
  return {offer: {totalRub: target, publicVisibleRub: target, previousTotalRub: null, priceDeltaRub: null, deliveryCity: quote.city},
    snapshot: {deliveryQuote: quote, deliveryPricingBasis: {...base, subtotalRub, deliveryRub: nextDelivery},
      paymentPlan: businessPaymentPlan('china', config, target)},
    breakdownPatch: {replace: delivered.filter(line => !same(line, byId.get(line.id))), order: delivered.map(line => line.id)}};
}

/** Assembly of previously saved values only; shared by preparation tests and
 * native readers. Does not calculate a price, rate, tariff or percentage. */
export function applyPreparedChinaCityPatch(full, patch) {
  let breakdown = full.calculationSnapshot?.breakdown;
  if (patch.breakdownPatch) {
    const byId = new Map((breakdown || []).map(line => [line.id, line]));
    for (const line of patch.breakdownPatch.replace) byId.set(line.id, line);
    need(new Set(patch.breakdownPatch.order).size === patch.breakdownPatch.order.length, 'city_patch_order');
    breakdown = patch.breakdownPatch.order.map(id => { need(byId.has(id), 'city_patch_line'); return byId.get(id); });
  }
  return {...full, ...patch.offer, calculationSnapshot: {...full.calculationSnapshot, ...patch.snapshot,
    ...(breakdown ? {breakdown} : {})}};
}

/** Scalar keys are equivalent to the accepted default display comparator.
 * The final ID tie gives one repeatable generation order for equal rows. */
export function chinaCanonicalOrderKeys(row) {
  const group = catalogDisplayGroup(row), freshness = Date.parse(String(row.auctionDate || row.sourcePublishedAt || row.firstSeenAt || row.updatedAt || '')) || 0;
  return {calculated: Number(calculatedCatalogPrice(row) > 0), group, expensivePrice: group === 2 ? catalogDisplayPrice(row) : 0,
    lowPower: group === 2 ? 0 : Number(catalogPowerBand(row) === 'low'), freshness, updatedAt: String(row.updatedAt || '')};
}

export function chinaPricingSourceDate(offer) { return catalogInventoryDate(offer); }
