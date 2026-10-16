import 'server-only';
import {createHash} from 'node:crypto';
import {ajesPassword} from './ajes-settings';
import {getJsonStorage} from '../data';
import {assertCollectionEnabled} from './collection-controls';
import {createAjesClient} from './ajes-client';
import {reserveAjesRequest} from './ajes-quota';

export const ajesClient=createAjesClient({
  password:ajesPassword,
  // Fixed-size cache: 128 slots, at most 256 KiB each. Collisions are misses.
  readQuery:async sql=>{
    const hash=createHash('sha256').update(sql).digest('hex');
    const saved:any=await getJsonStorage().readJson(`catalog/partner-cache/ajes/queries/${parseInt(hash.slice(0,8),16)%128}.json`,null);
    return saved?.hash===hash?saved.value:null;
  },
  saveQuery:async(sql,value)=>{
    const hash=createHash('sha256').update(sql).digest('hex'),saved={hash,value};
    if(Buffer.byteLength(JSON.stringify(saved))<=256*1024)await getJsonStorage().writeJson(`catalog/partner-cache/ajes/queries/${parseInt(hash.slice(0,8),16)%128}.json`,saved);
  },
  assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),
  reserve:table=>reserveAjesRequest(getJsonStorage(),table),
  readDetail:(table,id)=>getJsonStorage().readJson(`catalog/partner-cache/ajes/${table}/${id}.json`,null),
  saveDetail:(table,id,value)=>getJsonStorage().writeJson(`catalog/partner-cache/ajes/${table}/${id}.json`,value),
});
