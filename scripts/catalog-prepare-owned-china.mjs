import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Resolve orchestration from this controller, independently of the exact source
// working directory. The launcher re-samples resources for the materializer.
export function ownedChinaMaterializationInvocation({cutRunId,directory,root=process.cwd(),env=process.env}) {
 return {command:process.execPath,
  args:[fileURLToPath(new URL('./run-node-with-resources.mjs',import.meta.url)),
    '--import','tsx','scripts/catalog-auto-api-che168-bulk-intake.mjs'],
  options:{cwd:root,stdio:'inherit',env:{...env,OWNED_CHINA_CUT:cutRunId,
    AUTO_API_CHE168_REQUIRE_REPLICA:'1',AUTO_API_INTAKE_DIR:directory}}};
}

async function main() {
const {getJsonStorage}=await import('../apps/web/lib/data.ts');
const {selectChinaCut,commitChinaPrepared}=await import('./lib/owned-china-prepare.mjs');
const {archiveIntakeDirectory}=await import('./lib/nonjp-intake-archive.mjs');
const storage=getJsonStorage(),selection=await selectChinaCut(storage);
if(!selection){console.log(JSON.stringify({phase:'china_prepared_up_to_date'}));}
else{
 const {cut}=selection;
 console.log(JSON.stringify({phase:'china_preparing_saved_feed',runId:cut.runId,start:cut.startCursor,end:cut.cursor,changes:cut.rows}));
 const directory=path.resolve(process.env.RUNNER_TEMP??'.','owned-china-intake','catalog-intake-china');
 await fs.mkdir(directory,{recursive:true});
 const invocation=ownedChinaMaterializationInvocation({cutRunId:cut.runId,directory});
 const result=spawnSync(invocation.command,invocation.args,invocation.options);
 if(result.error)throw result.error;
 if(result.status!==0)throw Error('china_native_materialization_failed');
 const receipt=await archiveIntakeDirectory({storage,directory,market:'china'});
 const prepared=await commitChinaPrepared(storage,selection,receipt);
 console.log(JSON.stringify({phase:'china_prepared_in_reg',...prepared}));
}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
