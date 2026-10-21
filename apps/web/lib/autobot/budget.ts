import {randomUUID} from 'node:crypto';
import {mutateDataJson,readDataJson} from '../data';
type Ledger={spent:number;holds:Record<string,number>;calls:number;blocked?:boolean};
export const budgetMonth=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit'}).format(date);
const path=(month:string)=>'integrations/autobot/usage/'+month+'.json';
const empty=():Ledger=>({spent:0,holds:{},calls:0});
export function reserveInLedger(s:Ledger,id:string,amount:number,limit:number){if(!Number.isFinite(amount)||amount<=0||!Number.isFinite(limit)||limit<=0)throw Error('Проверьте лимит расходов.');if(s.blocked||s.spent+Object.values(s.holds).reduce((a,b)=>a+b,0)+amount>limit)throw Error('Лимит помощника на этот месяц исчерпан. Можно продолжить подбор в каталоге.');return {...s,holds:{...s.holds,[id]:amount}};}
export async function reserveBudget(amount:number,limit:number){const id=randomUUID(),month=budgetMonth();await mutateDataJson(path(month),empty(),s=>reserveInLedger(s,id,amount,limit));return {id,month};}
export async function settleBudget(ticket:{id:string;month:string},cost?:number){await mutateDataJson(path(ticket.month),empty(),s=>{const held=s.holds[ticket.id];if(held===undefined)return s;const holds={...s.holds};delete holds[ticket.id];return {...s,holds,spent:s.spent+(cost??held),calls:s.calls+1,blocked:s.blocked||(cost!==undefined&&cost>held)};});}
export async function budgetStatus(){const s=await readDataJson(path(budgetMonth()),empty());return {month:budgetMonth(),spent:s.spent,reserved:Object.values(s.holds).reduce((a,b)=>a+b,0),calls:s.calls,blocked:Boolean(s.blocked)};}
