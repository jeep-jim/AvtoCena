import type {ModelRecord} from '../../apps/web/lib/encyclopedia/schema';
export const savedPassengerModel=(row:{make:string})=>!['hitachi','komatsu'].includes(row.make.trim().toLowerCase());
// Narrow repair of this import's new, untouched records. No inventory count was
// captured for them: omit the optional snapshot instead of inventing a count.
export function repairSavedModelMetadata(record:ModelRecord,targetAt:string){
 if(record.directorySnapshot?.capturedAt!==targetAt||record.directorySnapshot.count!==undefined)return null;
 if(record.previousKey||record.updatedAt!==targetAt||record.editedBy||record.manualCreated||record.variants.some(v=>v.status!=='observed'||v.manualEditedAt))throw Error('reconciled_model_was_edited');
 const {directorySnapshot,...next}=record;
 // This owner-requested one-shot addition uses the existing explicit-addition
 // visibility flag. It does not mark any observed vehicle fact as verified.
 return {record:{...next,manualCreated:true},exclude:!savedPassengerModel(record)};
}
export function publishOwnerRequestedModel(record:ModelRecord,parent:ModelRecord,targetAt:string){
 if(record.directorySnapshot||record.manualCreated||record.editedBy||parent.directorySnapshot?.capturedAt!==targetAt||parent.directorySnapshot.count!==undefined||parent.previousKey||parent.updatedAt!==targetAt||record.id!==parent.id||record.make!==parent.make||record.model!==parent.model||JSON.stringify(record.variants)!==JSON.stringify(parent.variants)||record.variants.some(v=>v.status!=='observed'||v.manualEditedAt)||!savedPassengerModel(record))throw Error('owner_addition_repair_mismatch');
 return {...record,manualCreated:true};
}
