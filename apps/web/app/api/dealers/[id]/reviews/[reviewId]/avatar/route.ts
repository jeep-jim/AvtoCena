import {readChunkedDataJson,readDataJson,getJsonStorage} from '@/lib/data';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {accountPath,type CustomerAccount} from '@/lib/account/auth';
import {customerAvatar} from '@/lib/account/avatars';
export const dynamic='force-dynamic';
export async function GET(_request:Request,{params}:{params:Promise<{id:string;reviewId:string}>}){
 const {id,reviewId}=await params;
 if(!/^[-a-zA-Z0-9_]{1,100}$/.test(id)||!/^[a-f0-9]{64}$/.test(reviewId))return new Response(null,{status:404});
 try{
  const [showcase,dealer,reviews]=await Promise.all([readShowcase(id),findDealer(id),readChunkedDataJson<any>(`dealers/${id}/reviews.json`,[])]);
  const review=reviews.find(r=>r.id===reviewId&&r.dealerId===id&&r.status==='published');
  if(!showcase?.profileEnabled||dealer?.status!=='verified'||!review)return new Response(null,{status:404});
  const account=await readDataJson<CustomerAccount|null>(accountPath(review.userId),null);
  if(account&&!account.disabled&&account.avatarVersion){const file=await getJsonStorage().getBinary?.(`accounts/avatars/${account.id}.webp`);if(file)return new Response(new Uint8Array(file.data),{headers:{'Content-Type':'image/webp','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
  return new Response(null,{status:302,headers:{Location:customerAvatar('',account&&!account.disabled?account.avatarId:undefined),'Cache-Control':'no-store'}});
 }catch{return new Response(null,{status:404});}
}
