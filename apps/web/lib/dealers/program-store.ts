import {readDataJson,mutateDataJson} from '../data';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,normalizeProgram,addMonths,dealerAccessLevel,applyBasicAccess,type DealerProgram,type Membership} from './program-model';
import {validDealerId,findDealer} from './showcase-store';
import type {DealerShowcase} from './showcase-model';
export function readDealerProgram(){return readDataJson<DealerProgram>('dealers/program.json',DEFAULT_PROGRAM);}
export async function saveDealerProgram(raw:DealerProgram){let saved!:DealerProgram;await mutateDataJson<DealerProgram>('dealers/program.json',DEFAULT_PROGRAM,current=>{if(current.version!==raw.version)throw Error('Условия изменились в другой вкладке. Обновите страницу');saved={...normalizeProgram(raw),version:current.version+1};return saved;});return saved;}
export function readMembership(id:string){if(!validDealerId(id))throw Error('Компания не найдена');return readDataJson<Membership>(`dealers/memberships/${id}.json`,EMPTY_MEMBERSHIP);}
export async function startDealerTrial(id:string){if(!validDealerId(id)||id==='dealer_topavto')return;const p=await readDealerProgram();await mutateDataJson<Membership>(`dealers/memberships/${id}.json`,EMPTY_MEMBERSHIP,m=>{if(m.trialStartedAt)return m;const now=new Date();return {...m,version:m.version+1,trialStartedAt:now.toISOString(),trialEndsAt:new Date(now.getTime()+p.trialDays*86400000).toISOString()};});}
export async function grantDealerPeriod(id:string,raw:{version:number;months:number;amountRub:number;note:string},actorId:string){
 if(!validDealerId(id)||id==='dealer_topavto')throw Error('Для ТопАвто подписка не требуется');
 if(![1,6,12].includes(raw.months)||!Number.isFinite(raw.amountRub)||raw.amountRub<0||raw.amountRub>1e7||!String(raw.note||'').trim())throw Error('Укажите период, сумму и основание платежа');
 let saved!:Membership;await mutateDataJson<Membership>(`dealers/memberships/${id}.json`,EMPTY_MEMBERSHIP,m=>{if(m.version!==raw.version)throw Error('Доступ уже изменён. Обновите страницу');const now=new Date(),start=new Date(Math.max(now.getTime(),Date.parse(m.paidUntil)||0,Date.parse(m.trialEndsAt)||0));saved={...m,version:m.version+1,paidUntil:addMonths(start,raw.months).toISOString(),history:[...m.history,{id:crypto.randomUUID(),at:now.toISOString(),actorId,months:raw.months,amountRub:Math.round(raw.amountRub),note:String(raw.note).trim().slice(0,500)}]};return saved;});return saved;
}
export async function availableShowcase(s:DealerShowcase){const dealer=await findDealer(s.dealerId);if(s.dealerId!=='dealer_topavto'&&dealer?.status!=='verified')return {...applyBasicAccess(s),profileEnabled:false};return dealerAccessLevel(s.dealerId,await readMembership(s.dealerId)).full?s:applyBasicAccess(s);}
