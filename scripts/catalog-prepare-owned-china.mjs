import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {selectChinaCut,commitChinaPrepared} from './lib/owned-china-prepare.mjs';
import {archiveIntakeDirectory} from './lib/nonjp-intake-archive.mjs';
const storage=getJsonStorage(),selection=await selectChinaCut(storage);
if(!selection){console.log(JSON.stringify({phase:'china_prepared_up_to_date'}));}
else{
 const {cut}=selection;
 console.log(JSON.stringify({phase:'china_preparing_saved_feed',runId:cut.runId,start:cut.startCursor,end:cut.cursor,changes:cut.rows}));
 const directory=path.resolve(process.env.RUNNER_TEMP??'.','owned-china-intake','catalog-intake-china');
 await fs.mkdir(directory,{recursive:true});
 const result=spawnSync(process.execPath,['--import','tsx','scripts/catalog-auto-api-che168-bulk-intake.mjs'],
  {stdio:'inherit',env:{...process.env,OWNED_CHINA_CUT:cut.runId,AUTO_API_CHE168_REQUIRE_REPLICA:'1',AUTO_API_INTAKE_DIR:directory}});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('china_native_materialization_failed');
 const receipt=await archiveIntakeDirectory({storage,directory,market:'china'});
 const prepared=await commitChinaPrepared(storage,selection,receipt);
 console.log(JSON.stringify({phase:'china_prepared_in_reg',...prepared}));
}
