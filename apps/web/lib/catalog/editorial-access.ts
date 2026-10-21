import type {AuthUser} from '../auth';
import {isPlatformTeam} from '../platform-access';
import {hasCrmPermission} from '../crm-permissions';
export const canEditCatalog=(user:AuthUser|null|undefined)=>isPlatformTeam(user)&&hasCrmPermission(user,'catalog');
