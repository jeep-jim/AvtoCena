import {calculationFormSeed,type CalculationFormSeed} from '../autocalc/form-state';
export const AUTOBOT_SESSION_KEY='avtocena.autobot.tab.v1';
export type ChatMessage={role:'user'|'assistant';text:string;calculationForm?:CalculationFormSeed;path?:string;cards?:any[];sources?:{title:string;url:string}[];actions?:string[]};
export function parseChatSession(raw:string|null){
 const empty={messages:[] as ChatMessage[],draft:'',opened:false};
 if(!raw||raw.length>300000)return empty;
 try{const s=JSON.parse(raw);if(s.version!==1||!Array.isArray(s.messages))return empty;
 return {messages:s.messages.slice(-40).filter((m:any)=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map((m:any)=>({role:m.role,text:m.text.slice(0,12000),...(m.role==='assistant'&&m.calculationForm?{calculationForm:calculationFormSeed(m.calculationForm)}:{}),...(typeof m.path==='string'&&/^\/cars\/offer\/[a-zA-Z0-9_-]+$/.test(m.path)?{path:m.path}:{}),cards:Array.isArray(m.cards)?m.cards.filter((c:any)=>c&&typeof c.href==='string').slice(0,5):[],sources:Array.isArray(m.sources)?m.sources.filter((x:any)=>x&&typeof x.title==='string'&&typeof x.url==='string').slice(0,10):[],actions:Array.isArray(m.actions)?m.actions.filter((x:any)=>x==='contact'):[]})) as ChatMessage[],draft:typeof s.draft==='string'?s.draft.slice(0,4000):'',opened:s.opened===true};
 }catch{return empty;}
}
export function serializeChatSession(messages:ChatMessage[],draft:string,opened:boolean){return JSON.stringify({version:1,messages:messages.slice(-40),draft:draft.slice(0,4000),opened});}
