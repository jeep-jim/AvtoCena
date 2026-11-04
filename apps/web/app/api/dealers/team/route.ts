import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isDealerTeamOwner,updateDealerTeam} from '@/lib/dealers/team';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){const user=await getCurrentUser();const headers={'Cache-Control':'private, no-store'};if(!isCalculationOriginAllowed(request)||!isDealerTeamOwner(user)||!await canManageDealer(user,user!.companyId!))return Response.json({error:'Нет доступа'},{status:403,headers});try{const raw=await request.text();if(raw.length>3000)throw Error('Слишком большой запрос');const key=await updateDealerTeam(user!,JSON.parse(raw));return Response.json({ok:true,key},{headers});}catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить'},{status:400,headers});}}
