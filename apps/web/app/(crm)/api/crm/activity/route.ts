import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {readCrmActivity} from '@/lib/crm-activity';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return Response.json({error:'auth_required'},{status:401});
 const q=new URL(request.url).searchParams;
 const limit=Math.min(100,Math.max(1,Number(q.get('limit'))||30));
 return Response.json({userId:user.id,events:await readCrmActivity(user,limit,q.get('before')||'')},{headers:{'Cache-Control':'private, no-store'}});
}
