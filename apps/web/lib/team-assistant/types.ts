export type AssistantImage = {name:string;dataUrl:string};
export type AssistantPhoto = {name:string;url:string};
export type AssistantField = {id:string;label:string;value:string;options?:string[]};
export type AssistantContext = {path:string;title:string;text:string;fields:AssistantField[];photos?:AssistantPhoto[];links?:{label:string;path:string}[]};
export type AssistantAction = {id:string;kind:'fill'|'code'|'navigate';summary:string;path:string;destination?:string;fields?:{id:string;label:string;before:string;value:string}[];files?:{path:string;before:string;after:string}[];status?:'done';url?:string};
export type AssistantMessage = {id:string;role:'user'|'assistant';provider?:import('./providers').AssistantProvider;text:string;at:string;imageNames?:string[];photos?:AssistantPhoto[];actions?:AssistantAction[];sources?:{title:string;url:string}[]};
export type AssistantState = {messages:AssistantMessage[];revision:number;pageControl?:boolean;browserTurn?:import('./browser').BrowserTurn;busyUntil?:number;lease?:string;window?:number;count?:number};
export type AssistantStatus = {userId:string;name:string;owner:boolean;canControlPage:boolean;pageControl:boolean;canCode:boolean;canFill:boolean;connected:boolean;codeConnected:boolean;messages:AssistantMessage[];revision:number};
