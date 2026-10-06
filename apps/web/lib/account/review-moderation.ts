import {isPlatformTeam} from '../platform-access';
import {hasCrmPermission} from '../crm-permissions';
import type {AuthUser} from '../auth';
export function canReadCustomerReviews(user:AuthUser|null|undefined,dealerId:string){return isPlatformTeam(user)||!!user&&user.status!=='disabled'&&user.role==='dealer'&&user.companyId===dealerId&&user.dealerApproved===true;}
export function canDeleteCustomerReview(user:AuthUser|null|undefined,dealerId?:string){return !!user&&(isPlatformTeam(user)||!!dealerId&&canReadCustomerReviews(user,dealerId))&&hasCrmPermission(user,'deleteReviews');}
export function canReplyCustomerReview(user:AuthUser|null|undefined,dealerId:string){return canReadCustomerReviews(user,dealerId)&&hasCrmPermission(user,'replyReviews');}
