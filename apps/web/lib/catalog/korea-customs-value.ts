import {legalProductionReference, legalVehicleAgeBand, type RussiaCustomsV2Input} from '../../../../packages/engine/src/calculation/russiaCustomsV2';

/** Korea pricing policy: use the same production reference and age boundary as the customs engine. */
export function koreaIncludesLogistics(market: unknown, input: Pick<RussiaCustomsV2Input, 'productionDate' | 'year' | 'importedAt'>) {
  if (market !== 'korea') return false;
  const reference = legalProductionReference(input);
  return Boolean(reference && legalVehicleAgeBand(reference, input.importedAt || new Date()) === 'up_to_3_years');
}
