import {formatCatalogCount} from './count-format';

const countDate=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Novokuznetsk',day:'numeric',month:'long',year:'numeric'});

export type AjesCountSummary = {total:number; stale:boolean; observedAt:string; upperBound:boolean};
/** A list outage must not discard an independently received aggregate. */
export function ajesCountText(summary?:AjesCountSummary|null):string {
 if(!summary||summary.upperBound||!Number.isSafeInteger(summary.total)||summary.total<0)return 'Количество уточняется';
 const total=formatCatalogCount(summary.total);
 if(!summary.stale)return total;
 const observedAt=new Date(summary.observedAt);
 if(!Number.isFinite(observedAt.getTime()))return `${total} · сохранённый подсчёт`;
 return `${total} · данные на ${countDate.format(observedAt)}`;
}
export function exactAjesCount(summary?:AjesCountSummary|null):number|undefined {
 return summary&&!summary.stale&&!summary.upperBound&&Number.isSafeInteger(summary.total)&&summary.total>=0?summary.total:undefined;
}
/** A source upper bound is not the number of admitted cars. While the full
 * total is unknown, expose only rows that this exact query has actually shown. */
export function ajesVisibleCount(summary?:AjesCountSummary|null,loaded?:number) {
 const loadedCount=typeof loaded==='number'&&Number.isSafeInteger(loaded)&&loaded>=0?loaded:undefined;
 const exact=exactAjesCount(summary);
 // A late independent aggregate may describe a newer source observation. It
 // cannot turn already visible cars into a zero or a smaller exact selection.
 const total=exact!==undefined&&(loadedCount===undefined||exact>=loadedCount)?exact:undefined;
 if(total!==undefined)return {text:ajesCountText(summary),total,loadedCount,status:'exact' as const};
 const status=summary?.stale?'stale' as const:loadedCount&&loadedCount>0?'partial' as const:'pending' as const;
 return {text:loadedCount&&loadedCount>0?`Загружено ${formatCatalogCount(loadedCount)} · количество уточняется`:'Количество уточняется',total,loadedCount,status};
}
/** Aggregate counts survive cursor page filling. Admission may remove rows, so
 * a cursor's eventual page count is an upper bound, never an exact last link. */
export function ajesPaginationCountText(summary?:AjesCountSummary|null,pageSize=24):string {
 if(!summary||summary.upperBound||!Number.isSafeInteger(summary.total)||summary.total<0||!Number.isSafeInteger(pageSize)||pageSize<1)return 'Количество уточняется';
 return `${ajesCountText(summary)} · ${formatCatalogCount(Math.ceil(summary.total/pageSize))} стр.`;
}
