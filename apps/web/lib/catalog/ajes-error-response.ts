import {AjesUnavailable} from './ajes-client';
import {AjesFilterUnavailable,AjesInputError} from './ajes-query';
/** Fixed public codes only; never echo provider messages, credentials, SQL or IPs. */
export function ajesErrorResponse(error:unknown){
 const invalid=error instanceof AjesInputError||error instanceof AjesFilterUnavailable;
 const allowed=new Set(['client_ip_missing','visitor_restricted','not_configured','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_busy','invalid_response']);
 const reason=error instanceof AjesUnavailable&&allowed.has(error.reason)?error.reason:'operation_failed';
 return {status:invalid?400:503,body:{ok:false,error:error instanceof AjesFilterUnavailable?'japan_filters_unavailable':invalid?'invalid_japan_query':'japan_search_unavailable',...(!invalid?{reason}:{})}};
}
