/** Highlight only absent calculation inputs; optional dates and market-default freight stay neutral. */
export function missingCustomerFields(draft: Record<string,string>, showCommercial = false) {
 const missing = new Set<string>();
 const need = (key:string) => { if (!draft[key]?.trim()) missing.add(key); };
 need('year'); need('fuel');
 if (draft.vehicleCategory !== 'N1') need('powerHp');
 if (draft.fuel && draft.fuel !== 'electric') need('engineCc');
 if (showCommercial) need('vehicleCategory');
 if (draft.vehicleCategory === 'N1') need('grossVehicleWeightKg');
 if (draft.fuel === 'hybrid') {
  need('hybridKind');
  if (!(draft.vehicleCategory === 'N1' && draft.hybridKind === 'series_hybrid')) need('icePowerKw');
  if (draft.vehicleCategory === 'N1' && draft.hybridKind !== 'series_hybrid') need('n1IceFuel');
 }
 if (['electric','hybrid'].includes(draft.fuel) && !(draft.vehicleCategory === 'N1' && draft.hybridKind !== 'other_hybrid')) need('power30MinKw');
 return missing;
}
