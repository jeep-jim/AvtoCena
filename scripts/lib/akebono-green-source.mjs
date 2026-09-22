// The same anonymous, read-only catalog query used by Akebono's public stock page.
export const GREEN_ENDPOINT = 'https://akebono.world/graphql/catalog/open';
export const GREEN_QUERY = `query greenCornerLots($first:Int,$offset:Int,$filter:LotsFilter) {
 lotsPaginatedList:lots(first:$first,offset:$offset,filter:$filter) {
  items:nodes {id company model modelGrade year dateOfManufacture engineVolumeNum horsepower
    mileageNum transmission driveType color equipment frame modelType scores hasExportCertificate priceInJapan priceInJapanCurrency isSold location subgroup media createdAt discount discountPrice discountExpiresAt}
  totalCount:total
 }
}`;
export async function collectGreenCorner({request=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms)),pageSize=50}={}) {
 const items=[], seen=new Set(); let total;
 for(let offset=0; ;offset+=pageSize){
  let payload;
  for(let attempt=0;attempt<3;attempt++){
   try{
    const response=await request(GREEN_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({operationName:'greenCornerLots',query:GREEN_QUERY,variables:{first:pageSize,offset,filter:{objectPartner:{objectTypes:['auto'],isSold:false,awaiting:false}}}})});
    if(!response.ok){const error=Error(`green_source_http_${response.status}`);error.retryable=[408,429,500,502,503,504].includes(response.status);throw error;}
    payload=await response.json();break;
   }catch(error){if(error.retryable===false || attempt===2)throw error;await pause(30000*(attempt+1));}
  }
  if(payload.errors?.length)throw Error('green_graphql_errors');
  const page=payload.data?.lotsPaginatedList;
  if(!page||!Number.isSafeInteger(page.totalCount)||page.totalCount<1||!Array.isArray(page.items))throw Error('green_invalid_page');
  if(total===undefined)total=page.totalCount;
  if(total!==page.totalCount)throw Error('green_inventory_changed_during_scan');
  if(page.items.length!==Math.min(pageSize,total-offset))throw Error('green_incomplete_page');
  for(const item of page.items){
   const id=String(item.id);
   if(!/^\d+$/.test(id)||seen.has(id))throw Error('green_duplicate_or_invalid_id');
   if(item.isSold!==false||item.location!=='japan'||!['auto','oneprice'].includes(item.subgroup))throw Error('green_unexpected_inventory');
   seen.add(id);items.push(item);
  }
  if(items.length===total)return {total,items};
  await pause(3000);
 }
}
export function assertGreenPublication(previousCount,nextCount,sourceCount){
 if(!Number.isSafeInteger(sourceCount)||sourceCount<1||!Number.isSafeInteger(nextCount)||nextCount<1||nextCount>sourceCount)throw Error('green_empty_or_invalid_publication');
 if(previousCount>0&&nextCount<Math.ceil(previousCount*.9))throw Error('green_market_collapse_guard');
}
