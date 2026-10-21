import {getJsonStorage,type JsonStorage} from '../data';
import {readCollectionControls,saveCollectionSwitch} from './collection-controls';
import {collectionEnabled} from './collection-controls-schema';
const marker='catalog/operations/china-ajes-cutover-20261018.json';
/** One-time owner instruction. Later manual source changes must remain intact. */
export async function applyChinaFeedCutover(storage:JsonStorage=getJsonStorage()){
 if(await storage.readJson(marker,null))return;
 const controls=await readCollectionControls(storage);
 if(!collectionEnabled(controls,'ajes_china_feed'))throw Error('china_replacement_not_enabled');
 const next=await saveCollectionSwitch({scope:'source',id:'che168_feed',enabled:false,revision:controls.revision},'owner-request-20261018-china-ajes',storage);
 await storage.writeJson(marker,{version:1,at:new Date().toISOString(),revision:next.revision},{ifNoneMatch:'*'});
}
