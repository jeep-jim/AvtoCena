import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {readDataJson,readChunkedDataJson} from '@/lib/data';
import {canReadCustomerReviews,canReplyCustomerReview,canDeleteCustomerReview} from '@/lib/account/review-moderation';
import {findDealer} from '@/lib/dealers/showcase-store';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const actor=await getCurrentUser();if(!actor)return new Response(null,{status:401});
 const q=new URL(request.url).searchParams,selected=q.get('dealerId')||'';
 if(selected&&!/^[-a-zA-Z0-9_]{1,100}$/.test(selected))return new Response(null,{status:400});
 const platform=isPlatformTeam(actor),scope=selected||actor.companyId||'';
 if(!platform&&(!canReadCustomerReviews(actor,scope)||(await findDealer(scope))?.status!=='verified'))return new Response(null,{status:403});
 const stored=platform?await readDataJson<any[]>('dealers/dealers.json',[]):[(await findDealer(scope))];
 const dealers=[...new Map((platform?[{id:'dealer_topavto',name:'Top Avto'},...stored]:stored).filter(Boolean).map(d=>[d.id,d])).values()];
 const groups=[];
 for(const d of dealers){
  const reviews=await readChunkedDataJson<any>(`dealers/${d.id}/reviews.json`,[]);
  groups.push({dealerId:d.id,dealerName:d.name||d.id,rows:reviews.filter(r=>r.dealerId===d.id&&r.status==='published')});
 }
 const items=groups.filter(g=>!selected||g.dealerId===selected).flatMap(g=>g.rows.map(r=>({id:r.id,dealerId:g.dealerId,dealerName:g.dealerName,author:r.author||'Покупатель',text:r.text,rating:r.rating,createdAt:r.createdAt,reply:r.reply?{text:r.reply.text,createdAt:r.reply.createdAt}:null,canReply:canReplyCustomerReview(actor,g.dealerId),canDelete:canDeleteCustomerReview(actor,g.dealerId)}))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const rawPage=Number(q.get('page')),page=Number.isSafeInteger(rawPage)&&rawPage>0?Math.min(rawPage,Math.max(1,Math.ceil(items.length/50))):1;
 return Response.json({items:items.slice((page-1)*50,page*50),total:items.length,page,pages:Math.max(1,Math.ceil(items.length/50)),dealers:groups.map(g=>({id:g.dealerId,name:g.dealerName,count:g.rows.length})),platform},{headers:{'Cache-Control':'private, no-store'}});
}
