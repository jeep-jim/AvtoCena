import {getJsonStorage} from '../../apps/web/lib/data.ts';
import {MANIFEST} from '../../apps/web/lib/encyclopedia/records.ts';
import {checksum} from '../../apps/web/lib/encyclopedia/calculation-index.ts';
import {encyclopediaWithManagement,MANAGEMENT_KNOWLEDGE_PATH} from '../../apps/web/lib/catalog/management-knowledge.ts';
const digest=m=>checksum(m.models.map(x=>[x.id,x.revision,x.key]));
export async function publicReleaseSource(release,report){
 const storage=getJsonStorage();if(storage.driver!=='object')throw Error('durable_object_storage_required');
 const binding=await storage.readJson(`knowledge/encyclopedia/calculation-releases/${release}.json`,null);
 if(!report?.verified||binding?.release!==release||binding.digest!==report.indexDigest)throw Error('public_source_release_binding_mismatch');
 const manifest=await storage.readJson(MANIFEST,null);
 if(!manifest?.models||digest(manifest)!==report.manifestDigest)throw Error('public_source_manifest_mismatch');
 const empty={version:1,revision:'empty',models:{}},knowledge=await storage.readJson(MANAGEMENT_KNOWLEDGE_PATH,empty);
 const summaries=new Map(manifest.models.map(m=>[m.id,m])),cache=new Map();
 return {
  read(id){if(!cache.has(id))cache.set(id,(async()=>{
   const summary=summaries.get(id);if(!summary)throw Error('public_source_model_missing');
   const record=await storage.readJson(summary.key,null);
   if(record?.id!==id||record.revision!==summary.revision)throw Error('public_source_record_mismatch');
   return encyclopediaWithManagement(record,knowledge);
  })());return cache.get(id);},
  async verifyUnchanged(){
   if(digest(await storage.readJson(MANIFEST,null))!==report.manifestDigest)throw Error('public_source_changed');
   if((await storage.readJson(MANAGEMENT_KNOWLEDGE_PATH,empty)).revision!==knowledge.revision)throw Error('public_management_changed');
  }
 };
}
