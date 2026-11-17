import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import {hash,sourceHash,inspectCachePolicy,measureWorkingSet,MARKETS} from './lib/candidate-working-set.mjs';
import {installStagedBudgetNetworkFence} from './catalog-staged-budget-child.mjs';
import {installStagedBudgetStorage,verifyStagedBudgetAuthority} from './lib/catalog-staged-budget.mjs';
const [root,contextFile,pinsFile,output]=process.argv.slice(2);
try{
 const context=JSON.parse(await fs.readFile(contextFile,'utf8')),pins=JSON.parse(await fs.readFile(pinsFile,'utf8'));
 const checkSource=async()=>{
  if(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()!==context.release)throw Error('working_set_source_revision');
  for(const [file,sha] of Object.entries(pins))if(sourceHash(await fs.readFile(path.join(root,file),'utf8'))!==sha)throw Error('working_set_source_pin');
 };await checkSource();
 const pricingPath='apps/web/lib/catalog/shared-budget-prices.ts',policy=inspectCachePolicy(await fs.readFile(path.join(root,pricingPath),'utf8'),pins[pricingPath]);
 installStagedBudgetNetworkFence(process.env.YC_OBJECT_STORAGE_ENDPOINT,globalThis.fetch,false);
 const runtime=p=>import(pathToFileURL(path.join(root,p)).href);
 const {getJsonStorage}=await runtime('apps/web/lib/data.ts'),storage=getJsonStorage();if(storage.driver!=='object')throw Error('working_set_object_storage_required');
 const rawMeta=storage.readJsonWithMeta.bind(storage),authorityStorage={readJsonWithMeta:rawMeta,readJson:async(k,f)=>(await rawMeta(k,f)).value};
 installStagedBudgetStorage(storage,context,'verify');
 const pricing=await runtime(pricingPath),{budgetIndexBytes}=await runtime('apps/web/lib/catalog/budget-row-size.ts'),encyclopedia=await runtime('apps/web/lib/encyclopedia/calculation-index.ts');
 if(typeof pricing.readPreparedBudgetSelection!=='function'||typeof pricing.resetSharedBudgetPriceCache!=='function'||typeof budgetIndexBytes!=='function')throw Error('working_set_missing_api');
 const fingerprints=async()=>Object.fromEntries(await Promise.all(MARKETS.map(async m=>[m,await pricing.budgetPricingFingerprint(m)])));
 const expected=context.workingSetFingerprints;
 const assertAuthority=async()=>{
  // Real live health is checked by coordinator immediately around this process.
  // Here raw (non-overlay) base/lease and imported exact-runtime identity are checked.
  await verifyStagedBudgetAuthority(context,authorityStorage,async()=>({release:context.release,calculationVersion:context.calculationVersion}));
  if(pricing.calculationCacheVersion()!==context.calculationVersion||(encyclopedia.readCalculationIndex()?.digest||null)!==context.encyclopediaDigest||hash(await fingerprints())!==hash(expected))throw Error('working_set_runtime_context_changed');
 };
 let count=0,active=false;const reads=new Map(),read=storage.readJson.bind(storage);
 storage.readJson=async(k,f)=>{const v=await read(k,f);if(active){if(!/^catalog\/runtime-budget-selections-v1\/(china|korea|uae|europe|georgia)\/[a-f0-9]{64}\/(ready|parts\/(china|korea|uae|europe|georgia)\/[a-f0-9]{64})\.json$/.test(k))throw Error('working_set_unexpected_read');const sha256=hash(v);if(reads.has(k)&&reads.get(k)!==sha256)throw Error('working_set_read_changed');reads.set(k,sha256);count++;}return v;};
 const proof=await measureWorkingSet({context,pins,policy,fingerprints:expected,assertAuthority,
  reset:()=>pricing.resetSharedBudgetPriceCache(),sizeOf:budgetIndexBytes,readCount:()=>count,
  readSet:()=>[...reads].sort(([a],[b])=>a.localeCompare(b)).map(([key,sha256])=>({key,sha256})),
  readIndex:async(m,fp)=>{active=true;try{return await pricing.readPreparedBudgetSelection(context.manifest.generationId,m,fp);}finally{active=false;}}
 });
 await checkSource();await fs.writeFile(output,JSON.stringify(proof));console.log(JSON.stringify({stage:'candidate_working_set_verified',generationId:context.manifest.generationId,totalBytes:proof.totalBytes,maxBytes:policy.maxBytes,secondCycleReads:proof.secondCycleReads}));
}catch(error){console.error(['working_set_check_failed',String(error?.message||'').split(':')[0].replace(/[^A-Za-z0-9_]/g,'').slice(0,100)].join(':'));process.exitCode=1;}
