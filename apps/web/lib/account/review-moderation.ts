import {isPlatformTeam} from '../platform-access';
import type {AuthUser} from '../auth';
export function canDeleteCustomerReview(user:AuthUser|null|undefined){return isPlatformTeam(user)&&['owner','admin'].includes(user!.role);}
export function canReplyCustomerReview(user:AuthUser|null|undefined,dealerId:string){return canDeleteCustomerReview(user)||!!user&&user.status!=='disabled'&&user.role==='dealer'&&user.companyId===dealerId&&user.dealerApproved===true;}
