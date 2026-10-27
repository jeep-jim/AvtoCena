export type KoreaReportKind='history'|'inspection'|'description';
export type KoreaReportSection={kind:KoreaReportKind;title:string;status:'available'|'missing'|'unavailable';rows:Array<{label:string;value:string}>;description?:string};
export type KoreaReport={version:1;offerId:string;observedAt:string;sections:KoreaReportSection[]};
