import type {EncyclopediaManifest,ModelSummary} from './schema';
/** Publish the prepared model scope only if every original revision is still current. */
export function commitDirectorySnapshot(current:EncyclopediaManifest|null,baseline:EncyclopediaManifest,prepared:Map<string,ModelSummary>,additions:ModelSummary[],at:string):EncyclopediaManifest{
 if(!current||current.directoryCapturedAt)throw Error('directory_changed');
 const revisions=new Map(baseline.models.map(m=>[m.id,m.revision]));
 if(current.models.length!==baseline.models.length||current.models.some(m=>revisions.get(m.id)!==m.revision))throw Error('concurrent_edit_retry_required');
 const ids=new Set(current.models.map(m=>m.id));
 for(const model of additions){if(ids.has(model.id))throw Error('duplicate_directory_model');ids.add(model.id);}
 return {...current,directoryCapturedAt:at,updatedAt:at,models:[...current.models.map(m=>prepared.get(m.id)||m),...additions]};
}
