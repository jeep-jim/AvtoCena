import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {canSeeLead} from '@/lib/crm-visibility';
import {readChunkedDataJson,getJsonStorage} from '@/lib/data';
import {registeredClientAccount} from '@/lib/account/crm-registration';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return new Response(null,{status:403,headers});
 const id=new URL(request.url).searchParams.get('clientId');
 const client=(await readChunkedDataJson<any>('clients/clients.json',[])).find(c=>c.id===id&&!c.deletedAt&&canSeeLead(user,c));
 if(!client)return new Response(null,{status:404,headers});
 const account=await registeredClientAccount(client);if(!account?.avatarVersion)return new Response(null,{status:404,headers});
 const file=await getJsonStorage().getBinary?.(`accounts/avatars/${account.id}.webp`);
 if(!file)return new Response(null,{status:404,headers});
 return new Response(new Uint8Array(file.data),{headers:{...headers,'Content-Type':'image/webp'}});
}
