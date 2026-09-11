/** Only explicitly identified manufacturing data. Legacy productionDate may hold registration. */
export function confirmedProductionValue(offer:any) {
 const evidence=offer?.operational?.semanticEvidence?.productionDate;
 const raw=offer?.operational?.raw;
 const candidate=evidence?.status==="exact" && evidence?.source && /manufactur|production|produced|出厂/i.test(String(evidence.source))
  ? evidence.value : raw?.manufacturedate || raw?.producedate;
 const value=String(candidate || "");
 const match=value.match(/^((?:19|20)\d{2})(?:[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?)?$/);
 // A registration date or a date from another model year must not change age.
 if (!match || Number(match[1])!==Number(offer.year)) return "";
 if (match[3] && new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))).getUTCMonth()!==Number(match[2])-1) return "";
 return value.replace(/[/.]/g,'-');
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
