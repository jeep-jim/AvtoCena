import { latestLeadIncomingAt } from "./crm-alert-state";

export type LeadReadReceipt = { userId:string; displayName:string; seenAt:string; incomingAt:string; assignmentAt:string };
export function leadAssignmentTime(lead:any,userId:string):string {
  if(lead.assignedManagerId!==userId)return "";
  const history=Array.isArray(lead.managerHistory)?lead.managerHistory:[];
  return [...history].reverse().find((item:any)=>item.assignedManagerId===userId)?.changedAt || "";
}
export function leadReadState(lead:any,userId:string) {
  const incomingAt=latestLeadIncomingAt(lead);
  const assignmentAt=leadAssignmentTime(lead,userId);
  const receipt=(Array.isArray(lead.readReceipts)?lead.readReceipts:[]).find((row:LeadReadReceipt)=>row.userId===userId) as LeadReadReceipt|undefined;
  const newer=(value:string,seen?:string)=>Boolean(value)&&Date.parse(value)>(Date.parse(seen||"")||0);
  const assignmentUnread=newer(assignmentAt,receipt?.assignmentAt);
  return {incomingAt,assignmentAt,eventKey:JSON.stringify([incomingAt,assignmentAt]),unread:newer(incomingAt,receipt?.incomingAt)||assignmentUnread,assignmentUnread};
}
export function markLeadRead(lead:any,user:{id:string;displayName:string},eventKey:string,seenAt:string) {
  const state=leadReadState(lead,user.id);
  // Do not acknowledge a message/assignment that arrived after the user's screen loaded.
  if(state.eventKey!==eventKey)return null;
  const receipts:LeadReadReceipt[]=Array.isArray(lead.readReceipts)?lead.readReceipts:[];
  return {...lead,readReceipts:[...receipts.filter(row=>row.userId!==user.id),{userId:user.id,displayName:user.displayName,seenAt,incomingAt:state.incomingAt,assignmentAt:state.assignmentAt}]};
}
