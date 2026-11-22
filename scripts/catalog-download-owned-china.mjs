import {getJsonStorage} from '../apps/web/lib/data.ts';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
import {autoApiChe168Client} from './lib/auto-api-che168-client.mjs';
import {collectChinaDelta} from './lib/owned-china-delta.mjs';
import {bindFeedRates} from './lib/market-feed-rates.mjs';
import {recordChinaDownloadReceipt} from './lib/owned-china-verification.mjs';
const storage=getJsonStorage();
if(storage.driver!=='object')throw Error('china_object_storage_required');
await assertCollectionEnabled('che168_feed');
const client=autoApiChe168Client({platform:'che168',apiKey:process.env.AUTO_API_CHE168_KEY,requestDelayMs:200});
const completed=await collectChinaDelta({storage,runId:process.env.GITHUB_RUN_ID,
 bindRates:runId=>bindFeedRates('china','capture',{runId,storage}),
 request:async cursor=>{await assertCollectionEnabled('che168_feed');return client('changes',{change_id:cursor});},
 log:record=>console.log(JSON.stringify(record))});
await recordChinaDownloadReceipt(storage,completed,{runId:process.env.GITHUB_RUN_ID,
 attempt:process.env.GITHUB_RUN_ATTEMPT,producerSha:process.env.GITHUB_SHA});
