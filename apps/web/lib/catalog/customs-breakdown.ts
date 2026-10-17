/** Display expansion only: stored pricing keeps the aggregate customs contract. */
export function expandCustomsBreakdown(lines: any[], customs: any): any[] {
  const parts = (Array.isArray(customs?.breakdown) ? customs.breakdown : []).filter((line:any) =>
    !/utilization|утил/i.test(`${line.id} ${line.title}`) && Number.isFinite(line.amountRub) && line.amountRub > 0);
  const sum = parts.reduce((total:number,line:any) => total + line.amountRub,0);
  return lines.flatMap(line => line.id === "customs" && parts.length && Math.abs(sum-line.amountRub) < 1 ? parts : [line]);
}
