import type {ModelRecord} from '../../apps/web/lib/encyclopedia/schema';
export const savedPassengerModel=(row:{make:string})=>!['hitachi','komatsu'].includes(row.make.trim().toLowerCase());
// Narrow repair of this import's new, untouched records. No inventory count was
// captured for them: omit the optional snapshot instead of inventing a count.
export function repairSavedModelMetadata(record:ModelRecord,targetAt:string){
 if(record.directorySnapshot?.capturedAt!==targetAt||record.directorySnapshot.count!==undefined)return null;
 if(record.previousKey||record.updatedAt!==targetAt||record.editedBy||record.manualCreated||record.variants.some(v=>v.status!=='observed'||v.manualEditedAt))throw Error('reconciled_model_was_edited');
 const {directorySnapshot,...next}=record;
 return {record:next,exclude:!savedPassengerModel(record)};
}
