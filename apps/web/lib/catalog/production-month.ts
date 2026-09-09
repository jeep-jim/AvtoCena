/** Only explicitly identified manufacturing data. Legacy productionDate may hold registration. */
export function confirmedProductionMonth(offer:any):string {
 const evidence=offer?.operational?.semanticEvidence?.productionDate;
 const raw=offer?.operational?.raw;
 const candidate=evidence?.status==="exact" && evidence?.source && /manufactur|production|produced|出厂/i.test(String(evidence.source))
  ? evidence.value : raw?.manufacturedate || raw?.producedate;
 const match=String(candidate||"").match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?$/);
 return match && Number(match[1])===Number(offer.year)?String(Number(match[2])):"";
}
