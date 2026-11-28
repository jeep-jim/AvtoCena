import {formatCatalogCount} from './count-format';
import type {AjesCountProof} from './ajes-census';

const countDate=new Intl.DateTimeFormat('ru-RU',{timeZone:'Asia/Novokuznetsk',day:'numeric',month:'long',year:'numeric'});
export const AJES_COUNT_FRESH_MS=30*60_000;

export type AjesCountSummary = {total:number; stale:boolean; observedAt:string; upperBound:boolean;countProof?:AjesCountProof};
/** A retained proof keeps its original observation time. Failed refreshes
 * cannot extend the backend counter's thirty-minute freshness window. */
function agedCount(summary?:AjesCountSummary|null):AjesCountSummary|null {
 if(!summary||summary.stale)return summary??null;
 const observedAt=Date.parse(summary.observedAt);
 return !Number.isFinite(observedAt)||Date.now()-observedAt>=AJES_COUNT_FRESH_MS?{...summary,stale:true}:summary;
}
function admittedCount(summary?:AjesCountSummary|null):summary is AjesCountSummary {
 if(!summary||summary.upperBound||!Number.isSafeInteger(summary.total)||summary.total<0)return false;
 // Older completely exhausted pages also carry an exact count. When a census
 // proof is supplied, its coverage and admitted result must agree with it.
 const proof=summary.countProof;
 return proof===undefined||Boolean(proof)&&proof.version===1&&proof.kind==='japan-admitted-census'&&proof.complete===true
  &&proof.admittedTotal===summary.total&&proof.groupedTotal===proof.sourceTotal&&proof.sourceDistinctTotal===proof.sourceTotal
  &&[proof.sourceTotal,proof.knownTotal,proof.unknownTotal].every(value=>Number.isSafeInteger(value)&&value>=0)
  &&proof.knownTotal+proof.unknownTotal===summary.total;
}
/** A list outage must not discard an independently received aggregate. */
export function ajesCountText(summary?:AjesCountSummary|null):string {
 summary=agedCount(summary);
 if(!admittedCount(summary))return 'Количество уточняется';
 const total=formatCatalogCount(summary.total);
 if(!summary.stale)return total;
 const observedAt=new Date(summary.observedAt);
 if(!Number.isFinite(observedAt.getTime()))return 'Количество уточняется';
 return `${total} · данные на ${countDate.format(observedAt)}`;
}
export function exactAjesCount(summary?:AjesCountSummary|null):number|undefined {
 summary=agedCount(summary);
 return admittedCount(summary)&&!summary.stale?summary.total:undefined;
}
/** Keep a proven total through an append outage, and let a newer source
 * observation supersede it. These inputs must belong to the same query. */
export function latestAjesCountSummary(previous?:AjesCountSummary|null,incoming?:AjesCountSummary|null):AjesCountSummary|null {
 if(!admittedCount(incoming))return agedCount(previous??incoming);
 if(!admittedCount(previous))return agedCount(incoming);
 const priorTime=Date.parse(previous.observedAt),nextTime=Date.parse(incoming.observedAt);
 return agedCount(Number.isFinite(priorTime)&&(!Number.isFinite(nextTime)||priorTime>nextTime)?previous:incoming);
}
/** The heading is the full matching inventory. The number already appended is
 * independent metadata; it never substitutes for a missing inventory total. */
export function ajesVisibleCount(summary?:AjesCountSummary|null,loaded?:number) {
 summary=agedCount(summary);
 const loadedCount=typeof loaded==='number'&&Number.isSafeInteger(loaded)&&loaded>=0?loaded:undefined;
 const exact=exactAjesCount(summary);
 // A late independent aggregate may describe a newer source observation. It
 // cannot turn already visible cars into a zero or a smaller exact selection.
 const total=exact!==undefined&&(loadedCount===undefined||exact>=loadedCount)?exact:undefined;
 if(total!==undefined)return {text:ajesCountText(summary),total,loadedCount,status:'exact' as const};
 const staleText=summary?.stale?ajesCountText(summary):'Количество уточняется';
 const status=staleText!=='Количество уточняется'?'stale' as const:loadedCount&&loadedCount>0?'partial' as const:'pending' as const;
 return {text:staleText,total,loadedCount,status};
}
/** Aggregate counts survive cursor page filling. Admission may remove rows, so
 * a cursor's eventual page count is an upper bound, never an exact last link. */
export function ajesPaginationCountText(summary?:AjesCountSummary|null,pageSize=24):string {
 if(!admittedCount(summary)||!Number.isSafeInteger(pageSize)||pageSize<1)return 'Количество уточняется';
 const text=ajesCountText(summary);
 return text==='Количество уточняется'?text:`${text} · ${formatCatalogCount(Math.ceil(summary.total/pageSize))} стр.`;
}
