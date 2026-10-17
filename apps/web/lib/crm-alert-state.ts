export type AlertLead = {id:string;createdAt?:string;lastIncomingAt?:string;status?:string;car?:string;offerTitle?:string};
export function leadAlertTime(lead:AlertLead) {
  const parsed=Date.parse(lead.lastIncomingAt || lead.createdAt || "");
  return Number.isFinite(parsed)?parsed:0;
}
export function latestLeadIncomingAt(lead:{createdAt?:string;followups?:Array<{createdAt?:string}>}) {
  const timestamps=[lead.createdAt,...(Array.isArray(lead.followups)?lead.followups.map(item=>item.createdAt):[])].filter((v):v is string=>Boolean(v)&&Number.isFinite(Date.parse(v!)));
  return timestamps.sort((a,b)=>Date.parse(b)-Date.parse(a))[0] || "";
}
export function unseenNewLeads(leads:AlertLead[], acknowledged:number) {
  return leads.filter(lead=>(lead.status === "new" || leadAlertTime(lead)>Date.parse(lead.createdAt || "")) && leadAlertTime(lead)>acknowledged)
    .sort((a,b)=>leadAlertTime(b)-leadAlertTime(a));
}

export function canMigrateLegacyAcknowledgement(lead:AlertLead & {hasReadReceipt?:boolean;assignmentAt?:string},acknowledged:number) {
  const incoming=leadAlertTime(lead);
  return !lead.hasReadReceipt && !lead.assignmentAt && incoming>0 && incoming<=acknowledged && (lead.status==="new" || incoming>Date.parse(lead.createdAt||""));
}
