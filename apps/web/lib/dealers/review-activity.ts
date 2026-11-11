import {readDataJson,readRecentChunkedDataJson} from '../data';
import {leadDealerId} from './lead-routing';
import type {CrmActivity} from '../crm-activity';
export async function readReviewActivity(leads:any[],visibleLeadIds:Set<string>,all:boolean,limit:number,before=''):Promise<CrmActivity[]>{
 const dealers=all?await readDataJson<any[]>('dealers/dealers.json',[]):[];
 const companyIds=[...new Set(['dealer_topavto',...dealers.map(d=>d.id),...leads.filter(l=>all||visibleLeadIds.has(l.id)).map(l=>l.requestedDealerId||leadDealerId(l))])].filter(id=>typeof id==='string'&&/^[-a-zA-Z0-9_]{1,100}$/.test(id));
 const events:CrmActivity[]=[];
 // Bound concurrent storage reads; the review itself is the source of truth,
 // so pre-existing reviews appear and hidden reviews disappear without a backfill.
 for(let start=0;start<companyIds.length;start+=6){
  const batch=await Promise.all(companyIds.slice(start,start+6).map(async dealerId=>{
   const rows=await readRecentChunkedDataJson<any>(`dealers/${dealerId}/reviews.json`,limit,r=>r.status==='published'&&r.dealerId===dealerId&&(!before||r.createdAt<before)&&(all||visibleLeadIds.has(r.leadId)));
   return rows.map(r=>({id:`review:${r.id}`,createdAt:r.createdAt,type:'customer_review_published',title:`Новый отзыв · ${r.rating} ★`,actor:{id:`review-author:${r.id}`,name:r.author||'Покупатель',avatarUrl:`/api/dealers/${encodeURIComponent(dealerId)}/reviews/${r.id}/avatar`},entityType:'review',entityId:r.id,entityLabel:dealers.find(d=>d.id===dealerId)?.name||'Отзыв клиента',leadId:r.leadId,text:r.text,href:`/dealers/${encodeURIComponent(dealerId)}#reviews`,visibility:'team' as const}));
  }));events.push(...batch.flat());
 }
 return events.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,limit);
}
