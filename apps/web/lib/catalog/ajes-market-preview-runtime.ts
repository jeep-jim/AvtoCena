import 'server-only';
import {getJsonStorage} from '../data';
import {ajesPassword} from './ajes-settings';
import {assertCollectionEnabled} from './collection-controls';
import {reserveAjesRequest} from './ajes-quota';
import {createAjesMarketPreview,type AjesMarketPreview} from './ajes-market-preview';
export const previewAjesMarket=createAjesMarketPreview({
 password:ajesPassword,
 assertEnabled:market=>assertCollectionEnabled(`ajes_${market}_feed`),
 // Same existing budget as Japan stats; no new quota pool or reset for new tables.
 reserve:()=>reserveAjesRequest(getJsonStorage(),'stats'),
 read:market=>getJsonStorage().readJson<AjesMarketPreview|null>(`integrations/ajes/preview-${market}.json`,null),
 save:(market,value)=>getJsonStorage().writeJson(`integrations/ajes/preview-${market}.json`,value),
});
