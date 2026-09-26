import {CLIENT_STATUSES,clientStatusLabel} from "@/lib/crm-client-status";
import {readCrmUsers} from "@/lib/crm-users";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {recordCrmActivity,activityChanges,activityPerson} from "@/lib/crm-activity";
import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { canSeeLead } from "@/lib/crm-visibility";
import { updateChunkedDataJson } from "@/lib/data";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export async function PATCH(request:Request, context:{params:Promise<{id:string}>}) {
 if (!isCalculationOriginAllowed(request)) return NextResponse.json({error:"origin_forbidden"},{status:403});
 const user = await getCurrentUser();
 if (!user || !hasCrmPermission(user,"editClients")) return NextResponse.json({error:"auth_required"},{status:401});
 const body = await request.json().catch(()=>null);
 if (!body || ["fio","phone","telegram","city","comment","updatedAt"].some(key=>typeof body[key]!=="string")) return NextResponse.json({error:"invalid_fields"},{status:400});
 const fields = {...(typeof body.max === "string" ? {max:body.max.trim().slice(0,500)} : {}),fio:body.fio.trim().slice(0,500),phone:body.phone.trim().slice(0,500),telegram:body.telegram.trim().slice(0,500),city:body.city.trim().slice(0,500),comment:body.comment.trim().slice(0,4000)};
 if (!fields.fio && !fields.phone && !fields.telegram && !fields.max) return NextResponse.json({error:"client_contact_required"},{status:400});
 if(body.status!==undefined&&!Object.hasOwn(CLIENT_STATUSES,body.status))return NextResponse.json({error:"invalid_status"},{status:400});
 const assigning=typeof body.assignedManagerId==="string"&&hasCrmPermission(user,"assign");
 const managers=assigning?await readCrmUsers():[];
 if(assigning&&body.assignedManagerId&&!managers.some(m=>m.id===body.assignedManagerId&&m.status!=="disabled"&&isCrmRole(m.role)))return NextResponse.json({error:"manager_not_found"},{status:400});
 const {id} = await context.params;
 try {
  let previous:any;
  const client = await updateChunkedDataJson<any>("clients/clients.json",id,current=>{
   if (!canSeeLead(user,current)) throw Error("client_forbidden");
   if ((current.updatedAt||"")!==body.updatedAt) throw Error("client_conflict");
   previous=current;
   return {...current,...fields,...(body.status?{status:body.status}:{}),...(assigning?{assignedManagerId:body.assignedManagerId}:{}),updatedAt:new Date().toISOString(),updatedByManagerId:user.id};
  });
  if (!client) return NextResponse.json({error:"client_not_found"},{status:404});
  const changes=activityChanges(previous,client,{fio:"Имя",phone:"Телефон",telegram:"Telegram",max:"MAX",city:"Город",comment:"Комментарий"});
  if(changes.length)await recordCrmActivity(user,{type:"client_updated",title:"Изменён клиент",entityType:"client",entityId:id,clientId:id,entityLabel:client.fio||"Клиент",changes});
  const base={entityType:"client",entityId:id,clientId:id,entityLabel:client.fio||"Клиент"};
  if((previous.status||"new")!==(client.status||"new"))await recordCrmActivity(user,{...base,type:"client_status_changed",title:"Изменён статус клиента",changes:[{label:"Статус",before:clientStatusLabel(previous.status),after:clientStatusLabel(client.status)}]});
  if((previous.assignedManagerId||"")!==(client.assignedManagerId||"")){const manager=managers.find(m=>m.id===client.assignedManagerId);await recordCrmActivity(user,{...base,type:"client_assigned",title:"Назначен менеджер клиента",target:manager?activityPerson(manager):undefined,changes:[{label:"Ответственный",before:managers.find(m=>m.id===previous.assignedManagerId)?.displayName||"Не назначен",after:manager?.displayName||"Не назначен"}]});}
  return NextResponse.json({ok:true,client});
 } catch(error) {
  const code = error instanceof Error ? error.message : "storage_write_failed";
  return NextResponse.json({error:["client_forbidden","client_conflict"].includes(code)?code:"storage_write_failed"},{status:code==="client_forbidden"?403:code==="client_conflict"?409:500});
 }
}
