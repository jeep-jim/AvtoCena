import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {canSeeLead} from '@/lib/crm-visibility';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {readChunkedDataJson} from '@/lib/data';
import {normalizeRuPhone} from '@/lib/ru-phone';
import {leadDealerId} from '@/lib/dealers/lead-routing';
export const dynamic='force-dynamic';
export async function GET(req:Request){
 const headers={'Cache-Control':'private, no-store'};const user=await getCurrentUser();if(!isPlatformTeam(user)||!hasCrmPermission(user,'editLeads'))return Response.json({error:'forbidden'},{status:403,headers});
 const phone=normalizeRuPhone(new URL(req.url).searchParams.get('phone')||'');if(!phone)return Response.json({leads:[],clients:[]},{headers});
 const [leads,clients]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readChunkedDataJson<any>('clients/clients.json',[])]);
 const visible=(rows:any[])=>rows.filter(r=>leadDealerId(r)==='dealer_topavto'&&normalizeRuPhone(r.phone||'')===phone&&canSeeLead(user,r)).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 return Response.json({leads:visible(leads).map(l=>({id:l.id,name:l.name,createdAt:l.createdAt,office:l.createdOffice||'',status:l.status,car:l.car||l.offerTitle||''})),clients:visible(clients).map(c=>({id:c.id,name:c.fio,createdAt:c.createdAt}))},{headers});
}
