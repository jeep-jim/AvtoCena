import type {ajesLot} from './ajes-query';
type Lot=NonNullable<ReturnType<typeof ajesLot>>;
/** Reuse only a newer, successful full response for the identical paid-feed lot. */
export function newerKoreaDetail(lot:Lot,listObservedAt:string,saved:any,now=Date.now()):Lot{
 const at=Date.parse(saved?.observedAt||''),listAt=Date.parse(listObservedAt);
 if(lot.table!=='korea'||saved?.fullInformation!==true||saved?.stale||saved?.partial
  ||!Number.isFinite(at)||!Number.isFinite(listAt)||at<listAt||at>now||now-at>30*60000
  ||saved?.items?.length!==1)return lot;
 const detail=saved.items[0];
 return detail?.table==='korea'&&detail.id===lot.id?detail:lot;
}
