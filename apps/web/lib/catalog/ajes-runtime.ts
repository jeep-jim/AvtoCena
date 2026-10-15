import 'server-only';
import {ajesPassword} from './ajes-settings';
import {getJsonStorage} from '../data';
import {assertCollectionEnabled} from './collection-controls';
import {createAjesClient} from './ajes-client';
import {reserveAjesRequest} from './ajes-quota';

export const ajesClient=createAjesClient({
  password:ajesPassword,
  assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),
  reserve:table=>reserveAjesRequest(getJsonStorage(),table),
  readDetail:(table,id)=>getJsonStorage().readJson(`catalog/partner-cache/ajes/${table}/${id}.json`,null),
  saveDetail:(table,id,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/${table}/${id}.json`,value),
});
