import { NextResponse } from "next/server";
import { getCurrentUser,isCrmRole } from "@/lib/auth";
import { readChunkedDataJson,updateChunkedDataJson } from "@/lib/data";
import { canSeeLead } from "@/lib/crm-visibility";
import { leadReadState,markLeadRead } from "@/lib/crm-read-state";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params: Promise<{id:string}>}) {
  if(!isCalculationOriginAllowed(request))return NextResponse.json({error:"origin_forbidden"},{status:403});
  const user=await getCurrentUser();
  if(!user || !isCrmRole(user.role))return NextResponse.json({error:"auth_required"},{status:401});
  const body=await request.json().catch(()=>null);
  if(typeof body?.eventKey!=="string" || body.eventKey.length>300)return NextResponse.json({error:"invalid_event"},{status:400});
  const {id}=await params;
  const lead=(await readChunkedDataJson<any>("leads/leads.json",[])).find(row=>row.id===id);
  if(!lead || !canSeeLead(user,lead))return NextResponse.json({error:"lead_forbidden"},{status:403});
  try {
    const updated=await updateChunkedDataJson<any>("leads/leads.json",id,current=>{
      if(!canSeeLead(user,current))throw new Error("lead_forbidden");
      const next=markLeadRead(current,user,body.eventKey,new Date().toISOString());
      if(!next)throw new Error("event_changed");
      return next;
    });
    if(!updated)return NextResponse.json({error:"lead_not_found"},{status:404});
    return NextResponse.json({ok:true,readReceipts:updated.readReceipts||[],state:leadReadState(updated,user.id)},{headers:{"cache-control":"no-store"}});
  } catch(error) {
    const reason=error instanceof Error?error.message:"write_failed";
    return NextResponse.json({error:reason==="event_changed"?reason:"read_not_saved"},{status:reason==="event_changed"?409:reason==="lead_forbidden"?403:503});
  }
}
export async function GET(_request:Request,{params}:{params: Promise<{id:string}>}) {
  const user=await getCurrentUser();
  if(!user || !isCrmRole(user.role))return NextResponse.json({error:"auth_required"},{status:401});
  const {id}=await params;
  const lead=(await readChunkedDataJson<any>("leads/leads.json",[])).find(row=>row.id===id);
  if(!lead || !canSeeLead(user,lead))return NextResponse.json({error:"lead_forbidden"},{status:403});
  return NextResponse.json({ok:true,readReceipts:lead.readReceipts||[],state:leadReadState(lead,user.id)},{headers:{"cache-control":"no-store"}});
}
