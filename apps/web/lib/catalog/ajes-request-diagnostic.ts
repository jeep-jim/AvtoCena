/** Private last failed real supplier request; never part of public catalog responses. */
export type AjesRequestDiagnostic = {
 table: 'stats'|'main'|'korea'|'china'; kind: 'list'|'detail'|'count'|'models'|'makes'|'colors'; page:number; pageSize:number;
 startedAt:string; finishedAt:string; clientIp:string; sql:string; endpoint:string;
 httpStatus:number|null; providerCode:string|null; outcome:string;
};

// Fixed slots: eight early pages, one later-page slot and five other kinds per
// table. No per-visitor files and no unbounded request history.
export function ajesFailureSlot(value:Pick<AjesRequestDiagnostic,'table'|'kind'|'page'>){
 const kind=value.kind==='list'?`list-${Number.isSafeInteger(value.page)&&value.page>=1&&value.page<=8?value.page:'later'}`:value.kind;
 return `${value.table}-${kind}`;
}
export async function saveAjesRequestFailure(storage:{writeJson:(key:string,value:any)=>Promise<unknown>},value:AjesRequestDiagnostic){
 if(Buffer.byteLength(JSON.stringify(value))>64*1024)return;
 await Promise.all([
  storage.writeJson(`integrations/ajes/catalog-failure-${value.table}.json`,value),
  storage.writeJson(`integrations/ajes/catalog-failure-pages/${ajesFailureSlot(value)}.json`,value),
 ]);
}
