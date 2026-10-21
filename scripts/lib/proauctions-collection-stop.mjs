export function proAuctionsCollectionStopReason(error) {
  return error?.access === true ? 'source_access_refused' : 'transport_error_checkpointed';
}

export function proAuctionsRetryableDependencyError(error) {
  return error?.access === true || /http_5\d\d|timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND/i.test(String(error));
}
