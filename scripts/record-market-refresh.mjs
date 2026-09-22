import fs from 'node:fs/promises';
import path from 'node:path';
import {getJsonStorage} from '../apps/web/lib/data.ts';
const market=process.env.CATALOG_REBUILD_MARKETS;
if(!['china','korea','uae','georgia','europe','japan'].includes(market))throw Error('invalid_refresh_market');
const publication=JSON.parse(await fs.readFile(process.env.CATALOG_REBUILD_PUBLISH_REPORT,'utf8'));
if(publication.published!==true)throw Error('refresh_requires_committed_publication');
let intake=null;
if(market!=='japan')intake=JSON.parse(await fs.readFile(path.join(process.env.CATALOG_INTAKE_INPUT_DIR||'catalog-intake-input',`catalog-intake-${market}`,'report.json'),'utf8'));
await getJsonStorage().writeJson(`catalog/operations/markets/${market}.json`,{
 version:1,market,lastPublicationSuccess:new Date().toISOString(),lastCollectionSuccess:intake?.completedAt||null,
 sourceObservedAt:intake?.updatedAt||null,partialSources:intake?.partialSources||[],generationId:publication.generationId||null,runId:process.env.GITHUB_RUN_ID||null,
 sources:intake?.sources||[],qualityStatus:intake?.qualityStatus||null,
 powerMix:publication.powerMix?.[market]||null,sourceShare:publication.sourceShare?.[market]||null,publishedCount:publication.publishedMarketCount||null,
});
