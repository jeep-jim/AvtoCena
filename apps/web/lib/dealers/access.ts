import type {AuthUser} from '../auth';
import {isPlatformTeam,isPlatformOwner} from '../platform-access';
import {hasCrmPermission} from '../crm-permissions';
import {findDealer} from './showcase-store';
export function managesAllDealers(user:AuthUser|null|undefined){return isPlatformOwner(user);}
export async function canManageDealer(user:AuthUser|null|undefined,id:string){
 if(!user||user.status==='disabled')return false;
 if(managesAllDealers(user))return true;
 if(isPlatformTeam(user)&&id==='dealer_topavto'&&hasCrmPermission(user,'dealers'))return true;
 if(user.role!=='dealer'||user.companyId!==id||user.dealerApproved!==true)return false;
 const dealer=await findDealer(id);
 return dealer?.status==='verified';
}
