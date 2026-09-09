/** Only explicitly identified manufacturing data. Legacy productionDate may hold registration. */
export function confirmedProductionValue(offer:any) {
 const evidence=offer?.operational?.semanticEvidence?.productionDate;
 const raw=offer?.operational?.raw;
 const candidate=evidence?.status==="exact" && evidence?.source && /manufactur|production|produced|出厂/i.test(String(evidence.source))
  ? evidence.value : raw?.manufacturedate || raw?.producedate;
 return String(candidate || "");
}
export function confirmedProductionMonth(offer:any):string {
 const match=confirmedProductionValue(offer).match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.]\d{1,2})?$/);
 return match && Number(match[1])===Number(offer.year)?String(Number(match[2])):"";
}

export function confirmedProductionDay(offer: Parameters<typeof confirmedProductionMonth>[0]): string {
  if (!confirmedProductionMonth(offer)) return "";
  const match = confirmedProductionValue(offer).match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return match ? String(Number(match[3])) : "";
}
