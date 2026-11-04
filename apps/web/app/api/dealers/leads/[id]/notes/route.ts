import {assertWorkspace} from '@/lib/crm-workspace-access';
import {getCurrentUser} from '@/lib/auth';
import {isDealerWorkspace,workspaceCanSee} from '@/lib/crm-workspace';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {updateChunkedDataJson} from '@/lib/data';
export async function PATCH(req:Request,ctx:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!isDealerWorkspace(user)||!isCalculationOriginAllowed(req))return Response.json({error:'forbidden'},{status:403});
 try{await assertWorkspace(user);const raw=await req.text();if(raw.length>20000)throw Error('invalid');const b=JSON.parse(raw);for(const key of ['clientNotes','vehicleNotes'])if(typeof b[key]!=='string'||b[key].length>4000||typeof b.expected?.[key]!=='string')throw Error('invalid');
 const {id}=await ctx.params;const updated=await updateChunkedDataJson<any>('leads/leads.json',id,lead=>{if(!workspaceCanSee(user,lead))throw Error('forbidden');if((lead.dealerClientNotes||'')!==b.expected.clientNotes||(lead.dealerVehicleNotes||'')!==b.expected.vehicleNotes)throw Error('conflict');return {...lead,dealerClientNotes:b.clientNotes,dealerVehicleNotes:b.vehicleNotes,updatedAt:new Date().toISOString()};});
 return Response.json({ok:!!updated},{status:updated?200:404});
 }catch(e){const code=(e as Error).message;return Response.json({error:code},{status:code==='conflict'?409:code==='forbidden'?403:400});}
}
