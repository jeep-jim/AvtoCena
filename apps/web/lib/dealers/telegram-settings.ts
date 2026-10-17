import {readDataJson,mutateDataJson} from '../data';
import {validDealerId,findDealer} from './showcase-store';
import pilot from '../crm-group-target.json';
export type DealerTelegram={version:number;enabled:boolean;chatId:string;title:string;verifiedAt:string;verifiedBy:string};
const file='settings/dealer-telegram.json';
import {leadDealerId} from './lead-routing';
export {leadDealerId} from './lead-routing';
export function defaultDealerTelegram(id:string):DealerTelegram{return {version:0,enabled:id==='dealer_topavto',chatId:id==='dealer_topavto'?pilot.chatId:'',title:id==='dealer_topavto'?pilot.title:'',verifiedAt:'',verifiedBy:''};}
export async function readDealerTelegram(id:string){if(!validDealerId(id))throw Error('Компания не найдена');return (await readDataJson<Record<string,DealerTelegram>>(file,{}))[id]||defaultDealerTelegram(id);}
export async function saveDealerTelegram(id:string,input:DealerTelegram){if(!validDealerId(id))throw Error('Компания не найдена');let saved!:DealerTelegram;await mutateDataJson<Record<string,DealerTelegram>>(file,{},current=>{const all={dealer_topavto:defaultDealerTelegram('dealer_topavto'),...current};if(input.enabled&&Object.entries(all).some(([other,v])=>other!==id&&v.chatId===input.chatId))throw Error('Эта группа уже принадлежит другой компании');const previous=current[id]||defaultDealerTelegram(id);if(previous.version!==input.version)throw Error('Настройки изменились. Обновите страницу');saved={...input,version:previous.version+1};return {...current,[id]:saved};});return saved;}
export function targetForLead(lead:any,settings:Record<string,DealerTelegram>){const dealerId=leadDealerId(lead);if(!validDealerId(dealerId))return null;const c=settings[dealerId]||defaultDealerTelegram(dealerId);return c.enabled&&/^-\d{5,20}$/.test(c.chatId)&&c.title?{dealerId,chatId:c.chatId,title:c.title}:null;}
export async function leadTelegramTarget(lead:any){const target=targetForLead(lead,await readDataJson<Record<string,DealerTelegram>>(file,{}));if(target&&target.dealerId!=='dealer_topavto'&&(await findDealer(target.dealerId))?.status!=='verified')return null;return target;}
export function leadCrmUrl(lead:any){return leadDealerId(lead)==='dealer_topavto'?`https://avtocena.com/crm/leads?id=${encodeURIComponent(lead.id)}`:`https://avtocena.com/dealer-cabinet/leads?id=${encodeURIComponent(lead.id)}`;}
