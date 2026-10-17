import {findDealer} from '@/lib/dealers/showcase-store';
import {getCurrentUser} from '@/lib/auth';
import {canDeleteCustomerReview,canReplyCustomerReview} from '@/lib/account/review-moderation';
import {readAccountJson} from '@/lib/account/request';
import {updateChunkedDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
export async function GET(request:Request){const actor=await getCurrentUser(),dealerId=new URL(request.url).searchParams.get('dealerId')||'';return Response.json({canDelete:canDeleteCustomerReview(actor,dealerId),canReply:/^[-a-zA-Z0-9_]{1,100}$/.test(dealerId)&&await canReplyCustomerReview(actor,dealerId)},{headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});const actor=await getCurrentUser();if(!actor)return new Response(null,{status:403});try{const b=await readAccountJson(request);if(b.action!=='delete'||!/^[-a-zA-Z0-9_]{1,100}$/.test(b.dealerId||'')||!/^[a-f0-9]{64}$/.test(b.reviewId||''))throw Error('Отзыв не найден.');
 if(!canDeleteCustomerReview(actor,b.dealerId)||actor.role==='dealer'&&(await findDealer(b.dealerId))?.status!=='verified')return new Response(null,{status:403});
 // Keep the immutable review and its application reservation, hide only from public output.
 const result=await updateChunkedDataJson<any>(`dealers/${b.dealerId}/reviews.json`,b.reviewId,r=>{if(r.dealerId!==b.dealerId)throw Error('Отзыв недоступен.');return {...r,status:'hidden',deletedBy:actor.id,deletedAt:r.deletedAt||new Date().toISOString()};});if(!result)return new Response(null,{status:404});return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось удалить отзыв.'},{status:400});}}
