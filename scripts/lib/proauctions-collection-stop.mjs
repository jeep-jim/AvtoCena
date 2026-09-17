export function proAuctionsCollectionStopReason(error) {
  return error?.access === true ? 'source_access_refused' : 'transport_error_checkpointed';
}
