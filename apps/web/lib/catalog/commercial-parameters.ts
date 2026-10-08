import type {VehicleOffer} from './types';

/** Presentation and editable defaults only; document conflicts remain for the engine to reject. */
export function commercialParameters(offer: Partial<VehicleOffer>) {
  const body = String(offer.bodyType || '').normalize('NFKC');
  const identity = `${offer.make || ''} ${offer.model || ''} ${offer.sourceTitle || ''}`;
  const pickupBody = /pick[ -]?up|пикап|皮卡|픽업/i.test(body);
  const pickupModel = /\b(?:hilux|tacoma|tundra|ranger|amarok|colorado|gladiator|navara|frontier|d-?max|triton|l200|musso|rexton\s+sports|silverado|f-?150|ram\s*1500|poer|cannon|taga)\b/i.test(identity);
  const code = String(offer.tnVedCode || '').replace(/\D/g, '');
  const evidence = offer.operational?.semanticEvidence as {vehicleCategory?: {status?: string}} | undefined;
  const conflict = evidence?.vehicleCategory?.status === 'conflict';
  const explicit = offer.vehicleCategory === 'M1' || offer.vehicleCategory === 'N1' ? offer.vehicleCategory : '';
  const vehicleCategory = explicit || (conflict ? '' : code.startsWith('8703') ? 'M1' : code.startsWith('8704') ? 'N1' : pickupBody ? 'N1' : '');
  const isPickup = pickupBody || pickupModel;
  const showCommercial = isPickup || vehicleCategory === 'N1' || code.startsWith('8704')
    || /truck|commercial|груз/i.test(body) || conflict
    || Boolean(offer.calculationSnapshot?.customs?.missing?.includes('vehicle_category'));
  return {isPickup, showCommercial, vehicleCategory};
}
