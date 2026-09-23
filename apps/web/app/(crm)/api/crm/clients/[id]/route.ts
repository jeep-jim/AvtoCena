import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { canSeeLead } from "@/lib/crm-visibility";
import { updateChunkedDataJson } from "@/lib/data";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export async function PATCH(request:Request, context:{params:Promise<{id:string}>}) {
 if (!isCalculationOriginAllowed(request)) return NextResponse.json({error:"origin_forbidden"},{status:403});
 const user = await getCurrentUser();
 if (!user || !isCrmRole(user.role)) return NextResponse.json({error:"auth_required"},{status:401});
 const body = await request.json().catch(()=>null);
 if (!body || ["fio","phone","telegram","city","comment","updatedAt"].some(key=>typeof body[key]!=="string")) return NextResponse.json({error:"invalid_fields"},{status:400});
 const fields = {fio:body.fio.trim().slice(0,500),phone:body.phone.trim().slice(0,500),telegram:body.telegram.trim().slice(0,500),city:body.city.trim().slice(0,500),comment:body.comment.trim().slice(0,4000)};
 if (!fields.fio && !fields.phone && !fields.telegram) return NextResponse.json({error:"client_contact_required"},{status:400});
 const {id} = await context.params;
 try {
  const client = await updateChunkedDataJson<any>("clients/clients.json",id,current=>{
   if (!canSeeLead(user,current)) throw Error("client_forbidden");
   if ((current.updatedAt||"")!==body.updatedAt) throw Error("client_conflict");
   return {...current,...fields,updatedAt:new Date().toISOString(),updatedByManagerId:user.id};
  });
  if (!client) return NextResponse.json({error:"client_not_found"},{status:404});
  return NextResponse.json({ok:true,client});
 } catch(error) {
  const code = error instanceof Error ? error.message : "storage_write_failed";
  return NextResponse.json({error:["client_forbidden","client_conflict"].includes(code)?code:"storage_write_failed"},{status:code==="client_forbidden"?403:code==="client_conflict"?409:500});
 }
}
