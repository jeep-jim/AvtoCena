import type {AuthUser} from './auth';
import {isDealerWorkspace} from './crm-workspace';
import {isPlatformTeam} from './platform-access';
import {canManageDealer} from './dealers/access';
export async function assertWorkspace(user:AuthUser){if(isDealerWorkspace(user)){if(!await canManageDealer(user,user.companyId))throw Error('discussion_forbidden');}else if(!isPlatformTeam(user))throw Error('discussion_forbidden');}
