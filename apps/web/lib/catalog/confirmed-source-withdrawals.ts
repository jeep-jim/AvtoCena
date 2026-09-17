import type { UnavailableOffer } from './offer-availability';

// Reviewed exact-ID responses, linked in docs/all-market-integrity-20260916.md.
// Read-side quarantine preserves the immutable generations during the freeze.
const records = [
  {id:'b8809736fc4867fcedf2c64b',market:'korea',make:'Kia',model:'Ray',sourceId:'kcar_korea_open',sourceOfferId:'EC61409859',reason:'sold',removedAt:'2026-09-16T15:20:17Z'},
  {id:'62cbf7b61fc84ab0c5ef834b',market:'korea',make:'Kia',model:'Morning (JA)',sourceId:'kcar_korea_open',sourceOfferId:'EC61402490',reason:'sold',removedAt:'2026-09-16T15:20:17Z'},
  {id:'089cd85a95cbd1cbe4f59fd6',market:'korea',make:'Genesis',model:'G80',sourceId:'kcar_korea_open',sourceOfferId:'EC61398692',reason:'sold',removedAt:'2026-09-16T15:38:52Z'},
  {id:'eaabc602f5e5201268679eaa',market:'korea',make:'Genesis',model:'GV70',sourceId:'kcar_korea_open',sourceOfferId:'EC61401182',reason:'sold',removedAt:'2026-09-16T15:38:51Z'},
  {id:'16f36ebe37fa464a1f4fc792',market:'europe',make:'Dacia',model:'Sandero',sourceId:'autoscout_europe_open',sourceOfferId:'9e56324e-1c6e-44d8-8525-04f1a5809bad',reason:'removed',removedAt:'2026-09-16T15:20:30Z'},
] as const;

export function confirmedSourceWithdrawalById(id: string): UnavailableOffer | null {
  const row = records.find(record => record.id === id);
  return row ? {...row,sourceUrl:row.sourceId === 'kcar_korea_open'
    ? `https://www.kcar.com/bc/detail/carInfoDtl?i_sCarCd=${row.sourceOfferId}`
    : 'https://www.autoscout24.com/offers/dacia-sandero-sandero-1-0-sce-65-eu6e-essential-led-gra-allwette-gasoline-white-cat_ma16360mo19129-9e56324e-1c6e-44d8-8525-04f1a5809bad'} : null;
}

export function isConfirmedSourceWithdrawn(offer: {id?: string; market?: string; sourceId?: string; sourceOfferId?: string; updatedAt?: string}) {
  const row = records.find(record => record.id === offer.id);
  if (!row || offer.market !== row.market) return false;
  if (offer.sourceId && offer.sourceId !== row.sourceId) return false;
  if (offer.sourceOfferId && offer.sourceOfferId !== row.sourceOfferId) return false;
  // A later source refresh can reinstate a listing. An unlisted/failing source
  // is never classified as sold by this incident evidence.
  return !(Date.parse(offer.updatedAt || '') > Date.parse(row.removedAt));
}
