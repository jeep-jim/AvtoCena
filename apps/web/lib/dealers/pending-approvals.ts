import type {AuthUser} from '../auth';
import {isPlatformOwner} from '../platform-access';
import {readDataJson} from '../data';
import {readMembership} from './program-store';
export async function pendingDealerApprovals(user:AuthUser){
 if(!isPlatformOwner(user))return [];
 const dealers=await readDataJson<{id:string;name:string}[]>('dealers/dealers.json',[]);
 const rows=await Promise.all(dealers.filter(d=>d.id!=='dealer_topavto').map(async d=>{
  const {agreement:a}=await readMembership(d.id);
  if(!a?.submittedAt||a.approvedAt)return null;
  return {id:`dealer_approval:${d.id}:${a.submittedAt}`,dealerId:d.id,name:d.name,createdAt:a.submittedAt,href:`/crm/dealers/${encodeURIComponent(d.id)}#dealer-approval`,title:`Подтвердите подключение: ${d.name}`,text:'Дилер принял оферту. Проверьте реквизиты и полномочия представителя.'};
 }));
 return rows.filter((r):r is NonNullable<typeof r>=>r!==null).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
