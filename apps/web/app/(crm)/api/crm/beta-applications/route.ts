import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from '@/lib/platform-access';
import {readRecentChunkedDataJson} from '@/lib/data';
export const dynamic='force-dynamic';
export async function GET(){const actor=await getCurrentUser();if(!isPlatformTeam(actor)||!hasCrmPermission(actor,'site'))return new Response(null,{status:403});return Response.json({items:await readRecentChunkedDataJson('accounts/beta-applications.json',100)},{headers:{'Cache-Control':'private, no-store'}});}
