import {AjesUnavailable} from './ajes-client';
import {AjesFilterUnavailable,AjesInputError} from './ajes-query';
import {CollectionDisabledError} from './collection-controls';
import {ajesPublicFailureReason,publicAjesReadReceipt} from './ajes-read-receipt';
/** Fixed public codes only; never echo provider messages, credentials, SQL or IPs. */
export function ajesErrorResponse(error:unknown){
 const invalid=error instanceof AjesInputError||error instanceof AjesFilterUnavailable;
 const reason=error instanceof CollectionDisabledError?'source_disabled':error instanceof AjesUnavailable?ajesPublicFailureReason(error.reason):'operation_failed';
 const sourceReceipt=error instanceof AjesUnavailable?publicAjesReadReceipt((error as any).sourceReceipt):undefined;
 return {status:invalid?400:503,body:{ok:false,error:error instanceof AjesFilterUnavailable?'japan_filters_unavailable':invalid?'invalid_japan_query':'japan_search_unavailable',...(!invalid?{reason}:{}),...(sourceReceipt?{sourceReceipt}:{})}};
}
