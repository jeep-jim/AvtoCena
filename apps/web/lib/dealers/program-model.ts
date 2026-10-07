import type {DealerShowcase} from './showcase-model';
export type DealerProgram = {version:number;trialDays:number;monthRub:number;halfYearRub:number;yearRub:number;commissionPercent:number;commissionBasis:'sale'|'remuneration';policyVersion?:number;updatedAt:string};
export const DEFAULT_PROGRAM:DealerProgram={version:0,trialDays:30,monthRub:10000,halfYearRub:50000,yearRub:100000,commissionPercent:10,commissionBasis:'remuneration',policyVersion:2,updatedAt:''};
export type DealerAcceptance={version:string;text:string;digest:string;submittedAt:string;actorId:string;representative:string;authority:string;legalName:string;inn:string;ogrn:string;address:string;approvedAt?:string;approvedBy?:string};
export type Membership={agreementHistory?:DealerAcceptance[];agreement?:DealerAcceptance;plan?:'subscription'|'commission';version:number;trialStartedAt:string;trialEndsAt:string;paidUntil:string;history:{id:string;at:string;actorId:string;months:number;amountRub:number;note:string}[]};
export const EMPTY_MEMBERSHIP:Membership={version:0,trialStartedAt:'',trialEndsAt:'',paidUntil:'',history:[]};
export function dealerAccessLevel(id:string,m:Membership,now=new Date()){
 if(id==='dealer_topavto')return {level:'platform' as const,full:true,until:''};
 if(m.plan==='commission'&&m.agreement?.approvedAt)return {level:'commission' as const,full:true,until:''};
 if(Date.parse(m.paidUntil)>now.getTime())return {level:'paid' as const,full:true,until:m.paidUntil};
 if(Date.parse(m.trialEndsAt)>now.getTime())return {level:'trial' as const,full:true,until:m.trialEndsAt};
 return {level:'expired' as const,full:false,until:''};
}
export function normalizeProgram(raw:DealerProgram):DealerProgram {
 const n=(v:unknown,max:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max)throw Error('Проверьте суммы и процент комиссии');return v;};
 return {...DEFAULT_PROGRAM,version:raw.version,trialDays:Math.round(n(raw.trialDays,366)),monthRub:Math.round(n(raw.monthRub,1e7)),halfYearRub:Math.round(n(raw.halfYearRub,1e7)),yearRub:Math.round(n(raw.yearRub,1e7)),commissionPercent:n(raw.commissionPercent,100),commissionBasis:'remuneration',policyVersion:2,updatedAt:new Date().toISOString()};
}
export function addMonths(date:Date,months:number){const d=new Date(date);const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d;}
export const PREMIUM_FIELDS=['extraBanners','logoLight','logoDark','headerIcon','buyerPhotos','buyersEnabled','offers','specialsEnabled','specialHeading','stockEnabled','stockHeading','pricing','servicePricing'] as const;
export function restrictedShowcaseChange(current:DealerShowcase,next:DealerShowcase){return PREMIUM_FIELDS.some(k=>JSON.stringify(current[k])!==JSON.stringify(next[k]))||JSON.stringify(current.offices.map(o=>[o.id,o.photos]).filter(([,p])=>Array.isArray(p)&&p.length))!==JSON.stringify((next.offices||[]).map(o=>[o.id,o.photos]).filter(([,p])=>Array.isArray(p)&&p.length));}
export function applyBasicAccess(s:DealerShowcase):DealerShowcase{return {...s,buyersEnabled:false,buyerPhotos:[],specialsEnabled:false,stockEnabled:false,offers:[],extraBanners:[],logoLight:'',logoDark:'',headerIcon:'',offices:s.offices.map(o=>({...o,photos:[]}))};}

export function dealerCommissionPercent(m:Membership,now=new Date()){return m.plan==='commission'&&!!m.agreement?.approvedAt?15:Date.parse(m.paidUntil)>now.getTime()||Date.parse(m.trialEndsAt)>now.getTime()?10:null;}
export function remunerationCommission(amount:number,percent:number){if(!Number.isFinite(amount)||amount<=0||amount>1e9||![10,15].includes(percent))throw Error('Проверьте полученное вознаграждение и ставку');return Math.round(Math.round(amount*100)*percent/100)/100;}
