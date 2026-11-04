import type {AuthUser} from './auth';
import {hasCrmPermission,type CrmPermission} from './crm-permissions';
import {isPlatformTeam} from './platform-access';
import {canSeeLead} from './crm-visibility';
import {leadDealerId} from './dealers/lead-routing';
export function isDealerWorkspace(user:AuthUser|null|undefined):user is AuthUser & {companyId:string}{return !!user&&user.role==='dealer'&&!!user.companyId&&user.companyId!=='dealer_topavto'&&user.status!=='disabled'&&user.dealerApproved===true;}
export function workspacePermission(user:AuthUser|null|undefined,key:CrmPermission){
 if(!isDealerWorkspace(user))return isPlatformTeam(user)&&hasCrmPermission(user,key);
 if(['chat','editLeads','editClients','documents'].includes(key))return true;
 return ['assign','staff','deleteRecords'].includes(key)&&user.dealerTeamRole==='owner';
}
export function sameWorkspace(a:AuthUser,b:AuthUser){return isDealerWorkspace(a)?isDealerWorkspace(b)&&a.companyId===b.companyId:isPlatformTeam(a)&&isPlatformTeam(b);}
export function workspaceCanSee(user:AuthUser,entity:any,type:'lead'|'client'='lead'){
 if(!isDealerWorkspace(user))return isPlatformTeam(user)&&canSeeLead(user,entity);
 if(!entity||entity.deletedAt)return false;
 // Client records are read only from the company's own client store.
 if(type==='client')return entity.companyId===user.companyId;
 return leadDealerId(entity)===user.companyId&&!!entity.assignedManagerId&&!!entity.platformTerms?.agreementDigest;
}
export const workspaceRoot=(user:AuthUser)=>isDealerWorkspace(user)?`dealers/${encodeURIComponent(user.companyId)}/crm`:'crm';
export const workspaceHref=(user:AuthUser,section:string)=>isDealerWorkspace(user)?`/dealer-cabinet/company/${encodeURIComponent(user.companyId)}/${section==='clients'?'documents':section}`:`/crm/${section}`;
