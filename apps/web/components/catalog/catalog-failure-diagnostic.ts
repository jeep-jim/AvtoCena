/** Only fixed error classes/codes and generated-code locations may enter public logs. */
export function catalogFailureDiagnostic(error: unknown) {
  const value = error instanceof Error ? error : null;
  const names = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError']);
  const name = value && names.has(value.name) ? value.name : 'UnknownError';
  const message = value?.message || '';
  const prefix = /^(catalog_[a-z_]+|object_storage_[A-Za-z_0-9]+|detail_cache_[a-z_]+|green_[a-z_]+|japan_[a-z_]+)(?=[:\s]|$)/.exec(message)?.[1];
  const known: Record<string, string> = {
    'fetch failed': 'fetch_failed',
    'Invalid string length': 'invalid_string_length',
    'Maximum call stack size exceeded': 'call_stack_exceeded',
    'This operation was aborted': 'operation_aborted',
  };
  const rawCode = value && 'code' in value && typeof value.code === 'string' ? value.code : '';
  const network = /^(ECONNRESET|ETIMEDOUT|EPIPE|ENOMEM|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(rawCode) ? rawCode : undefined;
  const code = prefix?.slice(0, 96) || (Object.hasOwn(known, message) ? known[message] : undefined) || network || 'unclassified';
  const locations = (value?.stack?.match(/\.next\/server\/[A-Za-z0-9_./()\[\]-]+\.js:\d+:\d+/g) || []).slice(0, 6);
  return {name, code, locations};
}
