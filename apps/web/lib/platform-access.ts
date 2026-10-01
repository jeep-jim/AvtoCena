import type {AuthUser} from './auth';
// Reviewed TopAvto team, frozen at the aggregator pilot launch (2026-10-01).
// A new account or the owner role alone must never grant platform-wide access.
export const PLATFORM_TEAM_IDS:readonly string[]=['user_nstass','user_anton_molodykh90','user_vanes_32'];
export function isPlatformTeam(user:Pick<AuthUser,'id'|'companyId'|'role'|'status'>|null|undefined){
 return !!user&&user.status!=='disabled'&&user.companyId==='dealer_topavto'&&PLATFORM_TEAM_IDS.includes(user.id)&&['owner','admin','manager'].includes(user.role);
}
export function scopedAuthUser(user:AuthUser):AuthUser {
 return ['owner','admin','manager'].includes(user.role)&&!isPlatformTeam(user)?{...user,role:'dealer'}:user;
}
export function isPlatformOwner(user:AuthUser|null|undefined){return isPlatformTeam(user)&&user?.role==='owner';}
