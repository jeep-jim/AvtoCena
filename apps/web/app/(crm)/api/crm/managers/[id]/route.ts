import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole, isCrmRole } from "@/lib/auth";
import { appendChunkedDataJson, mutateDataJson } from "@/lib/data";
const ROLES = new Set(["owner","admin","manager"]);
export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser();
  if(!user||!isAdminRole(user.role)) return NextResponse.json({ok:false,error:"forbidden"},{status:403});
  const body=await request.json().catch(()=>({}));
  const operationId=String(body.operationId||"").trim()||`manager_${params.id}_${Date.now()}`;
  if(body.role && !ROLES.has(body.role)) return NextResponse.json({ok:false,error:"invalid_role"},{status:400});
  if((body.disable||body.role) && params.id===user.id) return NextResponse.json({ok:false,error:"cannot_modify_self"},{status:400});
  const now=new Date().toISOString();
  try{
    let before:any=null; let updated:any=null; let lastOwner=false;
    await mutateDataJson<any[]>("auth/users.json",[],(users)=>{
      before=users.find((manager)=>manager.id===params.id) || null;
      if(!before) return users;
      const activeOwners=users.filter((manager)=>manager.role==="owner" && manager.status!=="disabled");
      lastOwner=before.role==="owner" && activeOwners.length<=1 && (body.disable || (body.role && body.role!=="owner"));
      if(lastOwner) return users;
      return users.map((manager)=>{ if(manager.id!==params.id) return manager; updated={...manager}; if(body.role) updated.role=body.role; if(body.disable) updated.status="disabled"; if(body.enable) updated.status="active"; if(body.revokeSessions) updated.sessionVersion=Number(updated.sessionVersion||0)+1; updated.updatedAt=now; return updated; });
    });
    if(!before) return NextResponse.json({ok:false,error:"manager_not_found"},{status:404});
    if(lastOwner) return NextResponse.json({ok:false,error:"last_owner_protected"},{status:400});
    const auditId=`event_manager_${operationId}`;
    await appendChunkedDataJson("activity/feed.json",{id:auditId,operationId,createdAt:now,type:"manager_updated",title:"Менеджер изменён",managerId:user.id,targetManagerId:params.id,text:Object.keys(body).filter((key)=>key!=="operationId").join(", ")});
    return NextResponse.json({ok:true,manager:updated});
  }catch{return NextResponse.json({ok:false,error:"storage_write_failed"},{status:500});}
}
