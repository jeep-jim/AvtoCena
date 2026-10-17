/** Access refusals stop collection; they never mean a vehicle was sold. */
export function assertSourceAccess(status: number, body = '', source = 'catalog_source') {
  if ([401,403,429].includes(status)
    || /has_been_cr_blocked|cf-chl|<title>\s*(?:just a moment|access denied)|verify you are human/i.test(body.slice(0,10000))) {
    throw Object.assign(new Error(`${source}_access_blocked_http_${status}`), {blocked:true});
  }
}
export function optionalSourceDetailFailure(error: unknown): null {
  if ((error as any)?.blocked) throw error;
  return null;
}
