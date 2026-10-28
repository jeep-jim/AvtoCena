import {createHash} from 'node:crypto';
import {readDataJson} from '../data';

export function scenarioPath(id:string,version:string){
 return `offer-calculation-scenarios/${createHash('sha256').update(id).digest('hex')}/${version}.json`;
}
/** Read confirmed inputs only, without loading pricing, inventory or suppliers. */
export async function readSavedScenarioDraft(offerId:string,version:string){
 if(!/^[a-f0-9-]{36}$/i.test(version))return null;
 const record=await readDataJson<{offerId:string;version:string;draft:Record<string,string>}|null>(scenarioPath(offerId,version),null);
 return record?.offerId===offerId&&record.version===version?record.draft:null;
}
