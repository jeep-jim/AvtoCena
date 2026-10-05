import {hasCrmPermission} from '../crm-permissions';
import {isPlatformTeam} from '../platform-access';
import type {AuthUser} from '../auth';
export function canDeleteCustomerReview(user:AuthUser|null|undefined){return isPlatformTeam(user)&&hasCrmPermission(user,'deleteReviews');}
