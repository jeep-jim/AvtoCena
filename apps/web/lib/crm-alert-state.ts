export type AlertLead = {id:string;createdAt?:string;status?:string;car?:string;offerTitle?:string};
export function unseenNewLeads(leads:AlertLead[], acknowledged:number) {
  return leads.filter(lead=>lead.status === "new" && Number.isFinite(Date.parse(lead.createdAt || "")) && Date.parse(lead.createdAt!) > acknowledged)
    .sort((a,b)=>Date.parse(b.createdAt!)-Date.parse(a.createdAt!));
}
