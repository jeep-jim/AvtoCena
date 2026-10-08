import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {finishRecoveryRequest} from '@/lib/account/manual-recovery';
import {readAccountJson} from '@/lib/account/request';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!isPlatformOwner(user)||!isCalculationOriginAllowed(request))return new Response(null,{status:403,headers});
 try{const body=await readAccountJson(request);if(body.status!=='completed'&&body.status!=='rejected')throw Error('Неизвестное действие.');const row=await finishRecoveryRequest(user!,(await params).id,body.status,String(body.reason||''));return Response.json({ok:true,request:row},{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить результат.'},{status:400,headers});}
}
