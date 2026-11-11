import { canonicalSourceFuel } from './powertrain-safety';

/** K Car's secondary technical tab, bound to the same VIN as exact detail.
 * Never accept its unlabelled power alone: require agreement with labelled hp
 * in exact detail, combustion fuel, and leave physical sanity checks enabled.
 */
export function kcarRegistryEvidence(rvo: Record<string, any>, registry: any) {
  const vin = String(rvo.vin || '').trim().toUpperCase();
  const bound = /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
    && vin === String(registry?.basInfo?.vin || '').trim().toUpperCase();
  const result: {bound:boolean; powerHp?:number; productionDate?:string; detailPower?:number; registryPower?:number} = {bound};
  if (!bound) return result;
  const rawDate = String(registry?.productInfo?.prdcnDd || '');
  const match = rawDate.match(/^((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/);
  if (match) {
    const date = new Date(Date.UTC(+match[1], +match[2]-1, +match[3]));
    if (date.getUTCMonth() === +match[2]-1 && date.getTime() <= Date.now()) {
      result.productionDate = `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  const fuel = canonicalSourceFuel(rvo.fuelTypecdNm);
  const detail = String(rvo.hrspow ?? '').trim();
  const government = String(registry?.basInfo?.motoHghstOutpVal ?? '').trim();
  if (!['petrol','diesel','lpg','cng'].includes(fuel || '') || ['009','013'].includes(String(rvo.fuelType))) return result;
  if (!/^\d{2,4}(?:\.\d+)?$/.test(detail) || !/^\d{2,4}(?:\.\d+)?$/.test(government)) return result;
  result.detailPower = Number(detail); result.registryPower = Number(government);
  if (result.detailPower === result.registryPower && result.detailPower >= 20 && result.detailPower <= 1500) result.powerHp = result.detailPower;
  return result;
}
