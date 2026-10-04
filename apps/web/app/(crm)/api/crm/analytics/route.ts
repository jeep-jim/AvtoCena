import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {siteAnalytics} from '@/lib/metrika-reports';
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await getCurrentUser();if(!isPlatformTeam(user)||!hasCrmPermission(user,'activityAll'))return Response.json({error:'Нет доступа к аналитике'},{status:403});const report=await siteAnalytics(Number(new URL(request.url).searchParams.get('days')));return Response.json(report,{headers:{'Cache-Control':'private, no-store'}})}
