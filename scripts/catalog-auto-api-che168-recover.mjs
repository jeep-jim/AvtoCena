import path from 'node:path';
import {autoApiChe168Client} from './lib/auto-api-che168-client.mjs';
import {recoverLegacyChe168Snapshot} from './lib/auto-api-che168-recovery.mjs';
const request=autoApiChe168Client({apiKey:process.env.AUTO_API_CHE168_KEY,deadline:Date.now()+120*60000});
const report=await recoverLegacyChe168Snapshot({directory:path.join(process.env.CATALOG_INTAKE_INPUT_DIR||'catalog-intake-input','catalog-intake-china'),request});
console.log(JSON.stringify({recovered:true,productionWrites:false,source:report.sources[0],recovery:report.recovery}));
