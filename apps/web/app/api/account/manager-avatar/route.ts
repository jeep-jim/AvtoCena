import {currentAccount} from '@/lib/account/auth';
import {linkedClient,customerLeads,threadPath} from '@/lib/account/portal';
import {readCrmUsers} from '@/lib/crm-users';
import {getJsonStorage,readRecentChunkedDataJson} from '@/lib/data';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const account=await currentAccount();if(!account)return new Response(null,{status:401});
 try{
  const query=new URL(request.url).searchParams;
  const {client,link}=await linkedClient(account,query.get('client')||'');
  const [users,leads]=await Promise.all([readCrmUsers(),customerLeads(link.companyId,client.id)]);
  const managerId=client.assignedManagerId||leads.find(l=>l.assignedManagerId)?.assignedManagerId;
  let user=users.find(u=>u.id===managerId&&u.status!=='disabled');
  if(query.has('message')){
   const messages=await readRecentChunkedDataJson<any>(threadPath(link.companyId,client.id),100);
   const message=messages.find(m=>m.id===query.get('message')&&!m.accountId);
   if(!message)return new Response(null,{status:404});
   user=users.find(u=>u.status!=='disabled'&&(message.staffId?u.id===message.staffId:u.id===managerId&&u.displayName===message.author));
  }
  const match=user?.avatarUrl?.match(/^\/api\/crm\/users\/([^/?]+)\/avatar\?v=([a-f0-9]{24})$/);
  if(!user||!match||decodeURIComponent(match[1])!==user.id)return new Response(null,{status:404});
  const file=await getJsonStorage().getBinary?.(`auth/avatars/${encodeURIComponent(user.id)}/${match[2]}.webp`);
  if(!file)return new Response(null,{status:404});
  return new Response(new Uint8Array(file.data),{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response(null,{status:404});}
}
