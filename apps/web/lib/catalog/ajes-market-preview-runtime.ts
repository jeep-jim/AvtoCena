import 'server-only';
import {ajesEndpoint} from './ajes-routing';
import {getJsonStorage} from '../data';
import {ajesPassword} from './ajes-settings';
import {assertCollectionEnabled} from './collection-controls';
import {reserveAjesRequest} from './ajes-quota';
import {createAjesMarketPreview,type AjesMarketPreview,type AjesPreviewDiagnostic,type AjesPreviewMarket} from './ajes-market-preview';
export const readAjesPreviewDiagnostic=(market:AjesPreviewMarket)=>getJsonStorage().readJson<AjesPreviewDiagnostic|null>(`integrations/ajes/diagnostic-${market}.json`,null);
export const previewAjesMarket=createAjesMarketPreview({
 password:ajesPassword, endpoint:ajesEndpoint,
 assertEnabled:market=>assertCollectionEnabled(`ajes_${market}_feed`),
 // Separate usage telemetry by actual table; supplier limits remain authoritative.
 reserve:market=>reserveAjesRequest(getJsonStorage(),market),
 read:market=>getJsonStorage().readJson<AjesMarketPreview|null>(`integrations/ajes/preview-${market}.json`,null),
 save:(market,value)=>getJsonStorage().writeJson(`integrations/ajes/preview-${market}.json`,value),
 saveDiagnostic:(market,value)=>getJsonStorage().writeJson(`integrations/ajes/diagnostic-${market}.json`,value),
});
