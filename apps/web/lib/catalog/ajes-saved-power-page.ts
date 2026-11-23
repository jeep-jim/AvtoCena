type Snapshot<Lot> = {observedAt:string;items:Lot[]};

/** A partial auction page has no market-wide count. Use only other recently
 * observed lots that passed the same query and public specification checks. */
export async function fillSavedJapanPowerPage<Lot extends {id:string},Offer extends {id:string;sourceOfferId?:string}>(
 {items,pageSize,observedAt,matches,readCandidates,enrich}:{
   items:(Offer|null)[];pageSize:number;observedAt:string;matches:(offer:Offer)=>boolean;
   readCandidates:()=>Promise<Snapshot<Lot>[]|null>;
   enrich:(lot:Lot,observedAt:string)=>Promise<Offer|null>;
 }){
 const selected:Offer[]=[],seen=new Set<string>();
 for(const item of items){
  if(item?.sourceOfferId)seen.add(item.sourceOfferId);
  if(item&&matches(item))selected.push(item);
 }
 if(selected.length>=pageSize)return {items:selected,observedAt};
 const candidates=await readCandidates();
 if(!candidates)return {items:selected,observedAt};
 for(let start=0;start<candidates.length&&selected.length<pageSize;start+=12){
  const window=candidates.slice(start,start+12).filter(record=>{
   const lot=record.items[0];
   if(!lot||seen.has(lot.id))return false;
   seen.add(lot.id);return true;
  });
  const enriched=await Promise.all(window.map(record=>enrich(record.items[0],record.observedAt)));
  for(const [i,offer] of enriched.entries()){
   if(offer&&matches(offer)){
    selected.push(offer);
    if(window[i].observedAt<observedAt)observedAt=window[i].observedAt;
    if(selected.length===pageSize)break;
   }
  }
 }
 return {items:selected,observedAt};
}
