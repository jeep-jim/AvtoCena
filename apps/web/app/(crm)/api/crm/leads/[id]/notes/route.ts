import {getCurrentUser} from '@/lib/auth';
import {canSeeLead} from '@/lib/crm-visibility';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {updateChunkedDataJson} from '@/lib/data';
import {recordCrmActivity} from '@/lib/crm-activity';
export async function PATCH(req:Request,ctx:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user||!hasCrmPermission(user,'editLeads')||!isCalculationOriginAllowed(req))return Response.json({error:'forbidden'},{status:403});
 try{const raw=await req.text();if(raw.length>20000)throw Error('invalid');const b=JSON.parse(raw);for(const key of ['clientNotes','vehicleNotes'])if(typeof b[key]!=='string'||b[key].length>4000||typeof b.expected?.[key]!=='string')throw Error('invalid');
 const {id}=await ctx.params;const updated=await updateChunkedDataJson<any>('leads/leads.json',id,lead=>{if(!canSeeLead(user,lead))throw Error('forbidden');if((lead.clientNotes||'')!==b.expected.clientNotes||(lead.vehicleNotes||'')!==b.expected.vehicleNotes)throw Error('conflict');return {...lead,clientNotes:b.clientNotes,vehicleNotes:b.vehicleNotes,updatedAt:new Date().toISOString()};});
 if(!updated)return Response.json({error:'missing'},{status:404});await recordCrmActivity(user,{type:'lead_notes_updated',title:'Обновлены заметки заявки',entityType:'lead',entityId:id,leadId:id,clientId:updated.clientId,entityLabel:updated.name||'Клиент'});return Response.json({ok:true});
 }catch(e){const code=(e as Error).message;return Response.json({error:code==='conflict'?'conflict':'save_failed'},{status:code==='conflict'?409:code==='forbidden'?403:400});}
}
