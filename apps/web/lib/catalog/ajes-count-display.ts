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
/** Aggregate counts survive cursor page filling. Admission may remove rows, so
 * a cursor's eventual page count is an upper bound, never an exact last link. */
export function ajesPaginationCountText(summary?:AjesCountSummary|null,pageSize=24):string {
 if(!summary||summary.upperBound||!Number.isSafeInteger(summary.total)||summary.total<0||!Number.isSafeInteger(pageSize)||pageSize<1)return 'Количество уточняется';
 return `${ajesCountText(summary)} · ${formatCatalogCount(Math.ceil(summary.total/pageSize))} стр.`;
}
