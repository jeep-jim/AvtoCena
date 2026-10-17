import type {AuthUser} from './auth';
// Internal CRM roles are granted through the protected team administration API.
// External companies and the explicit dealer role remain tenant-scoped.
export function isPlatformTeam(user:Pick<AuthUser,'id'|'companyId'|'role'|'status'>|null|undefined){
 return !!user&&user.status!=='disabled'&&user.companyId==='dealer_topavto'&&['owner','admin','manager'].includes(user.role);
}
export function scopedAuthUser(user:AuthUser):AuthUser {
 return ['owner','admin','manager'].includes(user.role)&&!isPlatformTeam(user)?{...user,role:'dealer'}:user;
}
export function isPlatformOwner(user:AuthUser|null|undefined){return isPlatformTeam(user)&&user?.role==='owner';}
