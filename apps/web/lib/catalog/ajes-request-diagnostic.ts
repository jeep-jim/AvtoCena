/** Private last failed real supplier request; never part of public catalog responses. */
export type AjesRequestDiagnostic = {
 table: 'stats'|'main'|'korea'|'china'; kind: 'list'|'detail'|'count'|'models'|'makes'|'colors'; page:number; pageSize:number;
 startedAt:string; finishedAt:string; clientIp:string; sql:string; endpoint:string;
 httpStatus:number|null; providerCode:string|null; outcome:string;
};
