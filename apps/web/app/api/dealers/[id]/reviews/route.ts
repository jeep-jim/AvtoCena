import {getCurrentUser} from '@/lib/auth';
import {canReplyCustomerReview} from '@/lib/account/review-moderation';
import {readAccountJson} from '@/lib/account/request';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readChunkedDataJson,updateChunkedDataJson} from '@/lib/data';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {dealerReviewSummary,type DealerReview} from '@/lib/dealers/review-policy';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[-a-zA-Z0-9_]{1,100}$/.test(id))return new Response(null,{status:404});
 const [showcase,dealer]=await Promise.all([readShowcase(id),findDealer(id)]);
 if(!showcase?.profileEnabled||dealer?.status!=='verified')return new Response(null,{status:404});
 const reviews=(await readChunkedDataJson<DealerReview&{author?:string;reply?:{text:string;createdAt:string;updatedAt?:string}}>(`dealers/${id}/reviews.json`,[])).filter(r=>r.dealerId===id&&r.status==='published');
 return Response.json({...dealerReviewSummary(reviews,id),items:reviews.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50).map(r=>({id:r.id,author:r.author||'Покупатель',avatarUrl:`/api/dealers/${encodeURIComponent(id)}/reviews/${r.id}/avatar`,reply:r.reply?{text:r.reply.text,createdAt:r.reply.createdAt,updatedAt:r.reply.updatedAt}:null,text:r.text,rating:r.rating,createdAt:r.createdAt}))},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});
 const {id}=await params,actor=await getCurrentUser();
 if(!/^[-a-zA-Z0-9_]{1,100}$/.test(id)||!actor||!await canReplyCustomerReview(actor,id))return new Response(null,{status:403});
 if(actor.role==='dealer'&&(await findDealer(id))?.status!=='verified')return new Response(null,{status:403});
 try{
  const body=await readAccountJson(request),text=typeof body.text==='string'?body.text.trim():'';
  if(!/^[a-f0-9]{64}$/.test(body.reviewId||''))throw Error('Отзыв не найден.');
  if(text.length<3||text.length>3000)throw Error('Ответ должен содержать от 3 до 3000 символов.');
  const now=new Date().toISOString();
  const result=await updateChunkedDataJson<any>(`dealers/${id}/reviews.json`,body.reviewId,review=>{
   if(review.status!=='published'||review.dealerId!==id)throw Error('Отзыв недоступен.');
   return {...review,reply:{text,createdAt:review.reply?.createdAt||now,updatedAt:now,authorId:actor.id}};
  });
  if(!result)return new Response(null,{status:404});
  return Response.json({reply:{text:result.reply.text,createdAt:result.reply.createdAt,updatedAt:result.reply.updatedAt}},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось сохранить ответ.'},{status:400});}
}
