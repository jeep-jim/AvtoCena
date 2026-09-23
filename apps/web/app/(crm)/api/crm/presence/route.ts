import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {readCrmUsers} from '@/lib/crm-users';
import {readStaffPresence,touchStaffPresence,staffIsOnline} from '@/lib/staff-presence';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return json({error:'origin_forbidden'},403);
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return json({error:'auth_required'},401);
 await touchStaffPresence(user.id);return json({ok:true});
}
export async function GET(){
 const actor=await getCurrentUser();if(!actor||!isCrmRole(actor.role))return json({error:'auth_required'},401);
 const users=(await readCrmUsers()).filter(u=>u.status!=='disabled'&&isCrmRole(u.role)&&(!actor.companyId||u.companyId===actor.companyId));
 const team=await Promise.all(users.map(async u=>{const presence=await readStaffPresence(u.id);return {id:u.id,displayName:u.displayName,avatarUrl:u.avatarUrl,lastLoginAt:u.lastLoginAt,lastSeenAt:presence.lastSeenAt,online:staffIsOnline(presence.lastSeenAt)};}));
 return json({team});
}
