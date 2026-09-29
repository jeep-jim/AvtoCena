import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {deletionPreview,deleteCrmRecord} from '@/lib/crm-deletion';
type Context={params:Promise<{kind:string;id:string}>};
async function handle(request:Request,context:Context,remove:boolean){
 if(remove&&!isCalculationOriginAllowed(request))return NextResponse.json({error:'origin_forbidden'},{status:403});
 const user=await getCurrentUser();if(!user)return NextResponse.json({error:'auth_required'},{status:401});
 const {kind,id}=await context.params;if(!['client','lead'].includes(kind))return NextResponse.json({error:'not_found'},{status:404});
 try{
  if(!remove)return NextResponse.json(await deletionPreview(user,kind as 'client'|'lead',id),{headers:{'cache-control':'no-store'}});
  const body=await request.json().catch(()=>null);
  if(body?.confirm!==id||typeof body?.revision!=='string')return NextResponse.json({error:'confirmation_required'},{status:400});
  return NextResponse.json(await deleteCrmRecord(user,kind as 'client'|'lead',id,body.revision));
 }catch(error){const code=error instanceof Error?error.message:'';return NextResponse.json({error:code.startsWith('delete_')?code:'delete_failed'},{status:code==='delete_forbidden'?403:code==='delete_not_found'?404:['delete_linked','delete_conflict'].includes(code)?409:500});}
}
export const GET=(r:Request,c:Context)=>handle(r,c,false);
export const DELETE=(r:Request,c:Context)=>handle(r,c,true);
