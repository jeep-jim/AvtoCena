export const researchLabels: Record<string,string> = {year:'Год',fuel:'Топливо',engineCc:'Объём, см³',powerHp:'Мощность, л.с.',hybridKind:'Тип гибрида',icePowerKw:'Мощность ДВС, кВт',power30MinKw:'30-мин. мощность, кВт',bodyType:'Кузов',drive:'Привод',transmission:'Коробка передач'};
export type ResearchField = {key:string;value:string;sourceUrl?:string};
export type ResearchCandidate = {id:string;label:string;fields:ResearchField[];sources:{url:string;title:string}[];provenance:'reference'|'search';evidenceIds?:string[]};
export type ResearchResult = {candidates:ResearchCandidate[];searchStatus:'available'|'not_configured'|'unavailable'|'empty';message?:string};
