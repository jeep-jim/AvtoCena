import { NextResponse } from "next/server";
import { getAuthUsers, getCurrentUser, isAdminRole, isCrmRole } from "@/lib/auth";
import { generateId, readChunkedDataJson, updateChunkedDataJson } from "@/lib/data";
import { DEAL_STAGES } from "@/lib/crm";
export async function PATCH(request:Request,{params}:{params:{id:string}}){
  const user=await getCurrentUser(); if(!user||!isCrmRole(user.role)) return NextResponse.json({ok:false,error:"auth_required"},{status:401});
  const body=await request.json().catch(()=>({})); const operationId=String(body.operationId||"").trim()||generateId("operation"); const now=new Date().toISOString();
  const deals=await readChunkedDataJson<any>("deals/deals.json",[]); const existing=deals.find((deal)=>deal.id===params.id); if(!existing) return NextResponse.json({ok:false,error:"deal_not_found"},{status:404});
  const stages = (existing.stagesSnapshot||existing.marketStages||existing.stages||DEAL_STAGES).map((stage:any)=>typeof stage==="string"?{title:stage}:stage);
  const requestedStage = body.stageIndex===""||body.stageIndex==null ? existing.stageIndex : Number(body.stageIndex);
  if(!Number.isInteger(requestedStage) || requestedStage < 0 || requestedStage >= stages.length) return NextResponse.json({ok:false,error:"invalid_stage"},{status:400});
  const allowedStatuses = new Set(["active","paused","completed","cancelled"]);
  if(body.status && !allowedStatuses.has(body.status)) return NextResponse.json({ok:false,error:"invalid_status"},{status:400});
  if(!isAdminRole(user.role)&&existing.assignedManagerId!==user.id) return NextResponse.json({ok:false,error:"forbidden"},{status:403});

  const managers=await getAuthUsers(); if(body.assignedManagerId && !managers.some((manager)=>manager.id===body.assignedManagerId&&isCrmRole(manager.role)&&manager.status!=="disabled")) return NextResponse.json({ok:false,error:"manager_not_found"},{status:400});
  try{const updated=await updateChunkedDataJson<any>("deals/deals.json",params.id,(deal)=>{if((deal.history||[]).some((event:any)=>event.operationId===operationId)) return deal; const stages=(deal.stagesSnapshot||deal.marketStages||deal.stages||DEAL_STAGES).map((stage:any)=>typeof stage==="string"?{title:stage}:stage); const stageIndex=requestedStage; const currentComments=Array.isArray(deal.comments)?deal.comments:deal.comments?[{id:generateId("comment"),text:String(deal.comments),createdAt:deal.createdAt||now,createdByUserId:deal.createdByManagerId||user.id}]:[]; return {...deal,stageIndex,status:body.status??deal.status,assignedManagerId:body.assignedManagerId??deal.assignedManagerId,comments:body.comment?[...currentComments,{id:generateId("comment"),text:String(body.comment),createdAt:now,createdByUserId:user.id}]:currentComments,completedAtByStage:body.stageCompletedAt&&stages[stageIndex]?.title?{...(deal.completedAtByStage||{}),[stages[stageIndex].title]:body.stageCompletedAt}:deal.completedAtByStage,updatedAt:now,history:[...(deal.history||[]),{at:now,by:user.id,type:"deal_updated",title:"Сделка изменена",operationId,changes:Object.keys(body).filter((key)=>key!=="operationId")}]}}); return NextResponse.json({ok:true,deal:updated});}catch{return NextResponse.json({ok:false,error:"storage_write_failed"},{status:500});}
}
