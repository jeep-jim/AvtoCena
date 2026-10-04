import {readChunkedDataJson} from '@/lib/data';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {dealerReviewSummary,type DealerReview} from '@/lib/dealers/review-policy';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[-a-zA-Z0-9_]{1,100}$/.test(id))return new Response(null,{status:404});
 const [showcase,dealer]=await Promise.all([readShowcase(id),findDealer(id)]);
 if(!showcase?.profileEnabled||dealer?.status!=='verified')return new Response(null,{status:404});
 const reviews=(await readChunkedDataJson<DealerReview&{author?:string}>(`dealers/${id}/reviews.json`,[])).filter(r=>r.dealerId===id&&r.status==='published');
 return Response.json({...dealerReviewSummary(reviews,id),items:reviews.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(r=>({id:r.id,author:r.author||'Покупатель',text:r.text,rating:r.rating,createdAt:r.createdAt}))},{headers:{'Cache-Control':'public, max-age=30'}});
}
