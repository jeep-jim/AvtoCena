type HistoryRate = {
 currency?: string;
 history?: {date:string;effectiveRate:number}[];
};

// Supplement the chart only: a saved quote must keep its own rate and dates.
export function withRateChartHistory<T extends HistoryRate>(saved:T, current:HistoryRate | null):T {
 if (!current || !saved.currency || saved.currency.toUpperCase() !== current.currency?.toUpperCase()) return saved;
 const points=new Map<string,number>();
 for (const point of [...(current.history || []), ...(saved.history || [])]) {
  const date=String(point.date || '').slice(0,10), value=Number(point.effectiveRate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value) && value>0) points.set(date,value);
 }
 return {...saved,history:[...points].sort(([a],[b])=>a.localeCompare(b)).slice(-5).map(([date,effectiveRate])=>({date,effectiveRate}))};
}
