import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {navigationCounts,markNavigationSeen} from '@/lib/crm-navigation-counts';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){const user=await getCurrentUser();if(!isPlatformTeam(user))return Response.json({error:'Нет доступа'},{status:403,headers});return Response.json(await navigationCounts(user!),{headers});}
export async function POST(req:Request){const user=await getCurrentUser();if(!isPlatformTeam(user)||!isCalculationOriginAllowed(req))return Response.json({error:'Нет доступа'},{status:403,headers});try{const body=await readAccountJson(req);await markNavigationSeen(user!,String(body.section||''),String(body.through||''));return Response.json({ok:true},{headers});}catch{return Response.json({error:'Не удалось сохранить отметку'},{status:400,headers});}}
