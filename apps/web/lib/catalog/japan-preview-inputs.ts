import { japanPreviewParameters } from './japan-preview-parameters';
import { assessJapanExportRestriction } from './japan-export-restriction';
import type { VehicleOffer } from './types';

export type JapanPreviewInput = {
  updatedAt: string; sourcePrice: number | null; sourceCurrency: string | null;
  parameters: Partial<VehicleOffer> | null;
  offer: Pick<VehicleOffer, 'id' | 'market' | 'make' | 'model' | 'bodyType' | 'sourceTitle' | 'sourcePrice' | 'sourceCurrency' | 'tnVedCode' | 'personalUseEligible'>;
  restriction: VehicleOffer['japanExportRestriction'];
};
export type JapanPreviewInputIndex = {version: 1; generationId: string; entries: Record<string, JapanPreviewInput>};
export function japanPreviewInputPath(generationId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(generationId)) throw Error('invalid_catalog_generation');
  return `catalog/runtime/japan-preview-inputs-v1/${generationId}.json`;
}
export function compactJapanPreviewInput(offer: VehicleOffer): JapanPreviewInput {
  let parameters: Partial<VehicleOffer> | null;
  try { parameters = japanPreviewParameters(offer); } catch { parameters = null; }
  return {
    updatedAt: offer.updatedAt, sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency, parameters,
    offer: {id:offer.id,market:offer.market,make:offer.make,model:offer.model,bodyType:offer.bodyType,sourceTitle:offer.sourceTitle,
      sourcePrice:offer.sourcePrice,sourceCurrency:offer.sourceCurrency,tnVedCode:offer.tnVedCode,personalUseEligible:offer.personalUseEligible},
    restriction: assessJapanExportRestriction(offer),
  };
}
export function buildJapanPreviewInputIndex(generationId: string, offers: VehicleOffer[]): JapanPreviewInputIndex {
  return {version:1,generationId,entries:Object.fromEntries(offers.filter(o=>o.market==='japan' && o.catalogPricingMode==='seller').map(o=>[o.id,compactJapanPreviewInput(o)]))};
}
export function matchesJapanPreviewInput(entry: JapanPreviewInput, offer: Partial<VehicleOffer>) {
  return entry.updatedAt === offer.updatedAt && entry.sourcePrice === offer.sourcePrice && entry.sourceCurrency === offer.sourceCurrency;
}
