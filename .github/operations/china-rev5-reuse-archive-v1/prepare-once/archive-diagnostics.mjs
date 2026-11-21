// Aggregate-only closed diagnostic vocabulary. Never print raw Error.message.
const known=new Set([
 'intake_archive_requires_object_storage','intake_archive_bucket_inventory_missing','intake_archive_bucket_inventory_invalid',
 'intake_archive_storage_reserve_insufficient','intake_archive_source_changed','intake_archive_file_count','intake_archive_local_path',
 'intake_archive_local_inventory','intake_archive_part_wire','intake_archive_part_base64','intake_archive_part_checksum','intake_archive_file_checksum',
 'intake_archive_complete_changed','intake_archive_pin_changed','intake_archive_write_readback','intake_archive_manifest_bytes',
 'raw_pin_readback_mismatch','raw_pin_not_owned','raw_pin_ownership_lost','raw_pin_already_terminal','raw_handoff_ownership_changed',
 'raw_coord_handoff_not_coordinated','private_china_verified_ancestor_refs',
]);
const phaseNames=new Set(['read_raw_policy','verify_bucket_privacy','inventory_local_files','bucket_capacity_read','open_archive_raw_pin',
 'write_verify_archive_parts','write_archive_complete','bind_ready_handoff','verify_durable_archive','receipt_returned','convert_archive_files']);
export function classifyArchiveFailure(err){
 const m=typeof err?.message==='string'?err.message:'';
 if(known.has(m))return m;
 if(/^(?:china_rev5_successor|china_private_stage_privacy):[a-zA-Z0-9_-]{1,96}$/.test(m))return m;
 let q=m.match(/^object_storage_(read|write|list|head|metadata|binary_read|binary_write)_(\d{3})$/);
 if(q)return 'storage_'+q[1]+'_http_'+q[2];
 q=m.match(/^object_storage_(GET|PUT|HEAD)_unreachable:(?:object_storage_(?:GET|PUT|HEAD)_(\d{3}))?/);
 if(q)return 'storage_'+q[1].toLowerCase()+'_retry_limit'+(q[2]?'_http_'+q[2]:'');
 q=m.match(/^object_storage_(GET|PUT|HEAD)_(\d{3})(?::|$)/);
 if(q)return 'storage_'+q[1].toLowerCase()+'_http_'+q[2];
 if(m==='object_storage_response_limit')return 'storage_response_bound';
 if(/^intake_archive_local_size:/.test(m))return 'local_archive_file_size_bound';
 if(['ENOSPC','EDQUOT','ENOMEM','EIO','EACCES','EROFS','EFBIG'].includes(err?.code))return 'local_fs_'+err.code.toLowerCase();
 if(err?.name==='StorageConflictError')return 'storage_conditional_conflict';
 if(err?.name==='AssertionError')return 'unclassified_native_archive_assertion';
 if(err?.name==='AbortError'||err?.name==='TimeoutError')return 'native_archive_deadline';
 if(err?.name==='TypeError')return 'unclassified_native_archive_type';
 return 'unclassified_native_archive_failure';
}
export function createArchivePhaseMeter(emit=console.log,{now=Date.now}={}){
 let phase='inventory_local_files',start=now(),last=now(),reads=0,writes=0,readBytes=0,writeBytes=0;
 const report=(status,more={})=>emit(JSON.stringify({stage:'native_private_archive',phase,status,reads,writes,readBytes,writeBytes,
  elapsedMs:Math.max(0,now()-start),...more}));
 return Object.freeze({
  phase(p){if(!phaseNames.has(p))throw Error('archive_diagnostic_phase');
   if(phase!==p){phase=p;last=now();report('entered');}},
  accepted(type,bytes=0){
   if(!Number.isSafeInteger(bytes)||bytes<0||(type!=='read'&&type!=='write'))throw Error('archive_diagnostic_counter');
   if(type==='read'){reads++;readBytes+=bytes;}else{writes++;writeBytes+=bytes;}
   if(now()-last>=30_000){last=now();report('in_progress');}
  },
  held(err){const code=classifyArchiveFailure(err);report('held',{code});return new Error('china_rev5_successor:native_archive_'+code.replace(/:/g,'_'));},
  finished(){report('verified');},
 });
}
