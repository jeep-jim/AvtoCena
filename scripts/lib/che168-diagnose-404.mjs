/** Bounded read-only inspection; a 404 is not evidence of withdrawal. */
export async function diagnoseChe168404({request,cursor,maxPages=1000}) {
 let target=null,pages=0,checks=0,latest=null,latestId=-1,events=0,complete=false;
 while(pages<maxPages){
  const p=await request('changes',{change_id:cursor});
  if(!Array.isArray(p?.result)||p.meta?.cur_change_id!==cursor)throw Error('auto_api_invalid_changes');
  if(!p.result.length){complete=true;break;}
  const next=p.meta.next_change_id;
  if(!Number.isSafeInteger(next)||next<=cursor)throw Error('auto_api_stalled_changes');
  for(const e of p.result){
   if(!/^\d+$/.test(String(e?.inner_id||''))||!['added','changed','removed'].includes(e.change_type)
    ||!Number.isSafeInteger(e.id)||e.id<cursor||e.id>next||!Number.isFinite(Date.parse(e.created_at)))throw Error('auto_api_invalid_change');
  }
  if(!target){
   for(const e of p.result){
    if(e.change_type==='removed')continue;
    checks++;
    try{await request('offer',{inner_id:e.inner_id});}
    catch(error){if(error?.message!=='auto_api_http_404')throw error;target=String(e.inner_id);break;}
   }
  }
  for(const e of p.result)if(target&&String(e.inner_id)===target){events++;if(e.id>latestId){latest=e.change_type;latestId=e.id;}}
  cursor=next;pages++;
  if(!target&&pages>=5)break;
 }
 return {diagnosticComplete:true,mode:'detail_404',observed404:!!target,offerChecks:checks,changePagesInspected:pages,
  matchingEvents:events,latestEventType:latest,reachedEnd:complete,productionWrites:false};
}
