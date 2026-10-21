import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {readStaffProfiles} from '@/lib/crm-team';
import {readCrmUsers} from '@/lib/crm-users';
import {birthdayCelebrations,claimBirthdayCelebration} from '@/lib/crm-birthday-celebrations';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return Response.json({error:'origin_forbidden'},{status:403,headers});
 const user=await getCurrentUser();
 if(!user)return Response.json({error:'auth_required'},{status:401,headers});
 if(!isPlatformTeam(user))return Response.json({error:'forbidden'},{status:403,headers});
 try{
  const raw=await request.text();if(raw.length>1000)throw Error();
  const {id}=JSON.parse(raw);if(typeof id!=='string'||id.length>250)throw Error();
  const [users,profiles]=await Promise.all([readCrmUsers(),readStaffProfiles()]);
  const celebration=birthdayCelebrations(user,users,profiles,{}).find(row=>row.id===id);
  if(!celebration)return Response.json({celebration:null},{headers});
  const claimed=await claimBirthdayCelebration(user.id,id);
  return Response.json({celebration:claimed?celebration:null},{headers});
 }catch{return Response.json({error:'Не удалось открыть поздравление.'},{status:400,headers});}
}
