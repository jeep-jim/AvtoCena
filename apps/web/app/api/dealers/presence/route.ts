import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readCrmUsers} from '@/lib/crm-users';
import {readStaffPresence,touchStaffPresence,staffIsOnline} from '@/lib/staff-presence';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
async function actor(){const user=await getCurrentUser();return user?.role==='dealer'&&user.companyId&&await canManageDealer(user,user.companyId)?user:null;}
export async function GET(){
 const user=await actor();if(!user)return json({error:'forbidden'},403);
 const users=(await readCrmUsers()).filter(u=>u.companyId===user.companyId&&u.status!=='disabled'&&u.dealerApproved===true);
 const team=await Promise.all(users.map(async u=>{const presence=await readStaffPresence(u.id);return {id:u.id,displayName:u.displayName,avatarUrl:u.avatarUrl,personalPhone:u.personalPhone,lastLoginAt:u.lastLoginAt,lastSeenAt:presence.lastSeenAt,online:staffIsOnline(presence.lastSeenAt)};}));return json({team});
}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return json({error:'origin_forbidden'},403);const user=await actor();if(!user)return json({error:'forbidden'},403);await touchStaffPresence(user.id);return json({ok:true});}
