// Never retry a deterministic policy rejection, permission refusal, or corrupt data.
export function transientOperationFailure(output) {
 const text=String(output);
 if(/catalog_.*(?:guard|gate)_|checkpoint_.*(?:checksum|unsafe|invalid)|access_(?:401|403|429)|source_access_refused|proauctions_checkpoint_part_limit/.test(text))return false;
 return /object_storage_(?:GET|PUT|HEAD|DELETE)_unreachable|object_storage_(?:(?:GET|PUT|HEAD|DELETE|http|binary_write)_)?(?:408|425|429|500|502|503|504)|object_storage_response_timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timeout|timed.?out|http[_: ]5\d\d|fetch failed|transport_error_checkpointed|yandex_bridge_non_json_5\d\d|transient(?:[_: ]status)?[_: ]202|catalog_publish_lock_wait_failed/.test(text);
}
