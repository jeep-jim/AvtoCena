import {before,after} from 'node:test';
import {getJsonStorage} from '../../apps/web/lib/data';
import {COLLECTION_CONTROLS_KEY,clearCollectionControlsCache} from '../../apps/web/lib/catalog/collection-controls';
import {defaultCollectionControls} from '../../apps/web/lib/catalog/collection-controls-schema';
/** Explicit owner permission for offline parser fixtures; never writes real settings. */
export function enableChinaParserFixtures(){
 const storage=getJsonStorage(),original=storage.readJsonWithMeta.bind(storage);
 before(()=>{
  storage.readJsonWithMeta=async <T>(key:string,fallback:T)=>{
   if(key!==COLLECTION_CONTROLS_KEY)return original(key,fallback);
   const value=defaultCollectionControls();value.sources.che168_feed.enabled=false;
   value.sources.autohome_used_china_open.enabled=true;value.sources.autohome_new_china_open.enabled=true;
   return {found:true,value:value as T,etag:'fixture'};
  };clearCollectionControlsCache();
 });
 after(()=>{storage.readJsonWithMeta=original;clearCollectionControlsCache();});
}
