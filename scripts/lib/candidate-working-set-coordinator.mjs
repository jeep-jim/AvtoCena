import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile,execFileSync} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {hash,sourceHash,assertWorkingSetProof} from './candidate-working-set.mjs';
import {verifyStagedBudgetAuthority} from './catalog-staged-budget.mjs';
const run=promisify(execFile),child=fileURLToPath(new URL('../catalog-candidate-working-set-child.mjs',import.meta.url));
const FILES=['apps/web/lib/catalog/shared-budget-prices.ts','apps/web/lib/catalog/budget-row-size.ts','apps/web/lib/catalog/detail-read-cache.ts','apps/web/lib/data.ts'];
export async function prepareCandidateWorkingSet({storage,root,context,prepared}){
 const bound={...context,workingSetFingerprints:Object.fromEntries(Object.entries(prepared.markets).map(([m,r])=>[m,r.fingerprint]))};
 const pins={};
 const checkSource=async()=>{
  if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==context.release||execFileSync('git',['diff','--name-only','HEAD','--','apps/web/lib','packages','data','scripts'],{cwd:root,encoding:'utf8'}).trim())throw Error('working_set_runtime_source_changed');
  for(const f of FILES){const committed=execFileSync('git',['show',context.release+':'+f],{cwd:root,encoding:'utf8'});const sha=sourceHash(committed);if(sourceHash(await fs.readFile(path.join(root,f),'utf8'))!==sha||pins[f]&&pins[f]!==sha)throw Error('working_set_source_pin_changed');pins[f]=sha;}
 };await checkSource();await verifyStagedBudgetAuthority(bound,storage);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'candidate-working-set-')),ctx=path.join(directory,'context.json'),pin=path.join(directory,'pins.json'),out=path.join(directory,'proof.json');
 await fs.writeFile(ctx,JSON.stringify(bound));await fs.writeFile(pin,JSON.stringify(pins));
 const measure=async()=>{
  await checkSource();await verifyStagedBudgetAuthority(bound,storage);
  await run(process.execPath,['--import','tsx',child,root,ctx,pin,out],{cwd:root,env:{...process.env,AVTOCENA_RELEASE_SHA:context.release,AVTOCENA_CALCULATION_VERSION:context.calculationVersion,NODE_OPTIONS:process.env.CATALOG_BUDGET_PREPARATION_NODE_OPTIONS||'--max-old-space-size=6144'},timeout:30*60000,maxBuffer:1024*1024});
  await checkSource();await verifyStagedBudgetAuthority(bound,storage);
  return assertWorkingSetProof(JSON.parse(await fs.readFile(out,'utf8')),bound,pins);
 };
 const proof=await measure();await fs.writeFile('catalog-candidate-working-set.json',JSON.stringify(proof,null,2));
 // Re-measure in another cold process at commit verification. This rechecks live
 // authority, receipt freshness and all read hashes rather than trusting cache TTL.
 return async()=>{const current=await measure();assertWorkingSetProof(current,bound,pins,proof);};
}
