import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {getJsonStorage} from '@/lib/data';
import {listIdeas} from '@/lib/team-ideas';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(_req:Request,{params:pending}:{params:Promise<{ideaId:string;file:string}>}){
 const params=await pending;const user=await getCurrentUser();const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(!user||!isPlatformTeam(user))return new Response(null,{status:403,headers});
 if(!/^[a-f0-9-]{36}$/.test(params.ideaId)||! /^[0-4]\.webp$/.test(params.file))return new Response(null,{status:404,headers});
 const key=`${params.ideaId}/${params.file}`;
 const row=(await listIdeas(user)).find(r=>r.id===params.ideaId);
 if(!row?.screenshots.includes(key))return new Response(null,{status:404,headers});
 try{const data=await getJsonStorage().getBinary?.(`crm/team-ideas/media/${key}`);if(!data)return new Response(null,{status:404,headers});return new Response(new Uint8Array(data.data),{headers:{...headers,'Content-Type':'image/webp'}});}catch{return new Response(null,{status:404,headers});}
}
