import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesErrorResponse} from '../apps/web/lib/catalog/ajes-error-response';
import {CollectionDisabledError} from '../apps/web/lib/catalog/collection-controls';
import {AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';

test('only the real owner collection switch exposes the fixed public disabled reason',()=>{
 assert.deepEqual(ajesErrorResponse(new CollectionDisabledError('private-source-id')),{
  status:503,body:{ok:false,error:'japan_search_unavailable',reason:'source_disabled'},
 });
 for(const error of [
  new Error('private-source-id settings storage unavailable'),
  Object.assign(new Error('collection_disabled_by_owner:private-source-id'),{name:'CollectionDisabledError',sourceId:'private-source-id'}),
  new AjesUnavailable('source_disabled'),
 ]){
  const result=ajesErrorResponse(error);
  assert.equal(result.status,503);assert.equal(result.body.reason,'operation_failed');
  assert.equal(JSON.stringify(result).includes('private-source-id'),false);
 }
 assert.equal(ajesErrorResponse(new AjesUnavailable('visitor_restricted')).body.reason,'visitor_restricted');
});
