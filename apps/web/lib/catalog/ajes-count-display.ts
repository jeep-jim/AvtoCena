import {formatCatalogCount} from './count-format';

export type AjesCountSummary = {total:number; stale:boolean; observedAt:string; upperBound:boolean};
/** A list outage must not discard an independently received aggregate. */
export function ajesCountText(summary?:AjesCountSummary|null):string {
 if(!summary||!Number.isSafeInteger(summary.total)||summary.total<0)return 'Количество уточняется';
 return `${summary.upperBound?'до ':''}${formatCatalogCount(summary.total)}${summary.stale?' · по последним данным':''}`;
}
export function exactAjesCount(summary?:AjesCountSummary|null):number|undefined {
 return summary&&!summary.stale&&!summary.upperBound&&Number.isSafeInteger(summary.total)&&summary.total>=0?summary.total:undefined;
}
