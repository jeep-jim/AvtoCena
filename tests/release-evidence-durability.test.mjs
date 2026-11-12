import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const controller=fs.readFileSync('.github/workflows/owner-navigation-release.yml','utf8');
const block=controller.split("<<'DURABLE_RELEASE_EVIDENCE'\n")[1]?.split('          DURABLE_RELEASE_EVIDENCE\n')[0];
assert.ok(block,'durable preservation implementation is missing');
const implementation=block.split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
const {preserveEvidence}=await import('data:text/javascript;base64,'+Buffer.from(implementation).toString('base64'));

const release='a'.repeat(40),calculator='b'.repeat(64),markets=['china','korea','europe','uae','georgia'];
const valid={markets,generationId:'gen_current',results:markets.map(market=>({market,status:'success'}))};
async function fixture(run){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'release-evidence-'));
 const objects=new Map(),writes=[];
 const storage={driver:'object',async readJson(key){return key==='catalog/manifest.json'?{generationId:'gen_current'}:objects.get(key)??null;},async writeJson(key,value,condition){writes.push({key,condition});assert.deepEqual(condition,{ifNoneMatch:'*'});if(objects.has(key)){const error=new Error();error.name='StorageConflictError';throw error;}objects.set(key,structuredClone(value));}};
 const options={storage,filename:path.join(directory,'report.json'),name:'market-preparation',release,runId:'123',attempt:'1',calculationVersion:calculator,required:true,expectedMarkets:markets};
 fs.writeFileSync(options.filename,JSON.stringify(valid));
 try{await run({options,objects,writes});}finally{fs.rmSync(directory,{recursive:true,force:true});}
}
test('exact successful market evidence is immutable, read back and idempotent',()=>fixture(async({options,objects,writes})=>{
 const first=await preserveEvidence(options),second=await preserveEvidence(options);
 assert.deepEqual(first,second);assert.equal(first.produced,true);assert.equal(objects.size,1);assert.equal(writes.length,2);
 assert.match(first.key,new RegExp('^operations/release-evidence/'+release+'/123-1/market-preparation.json$'));
 assert.equal(JSON.parse(objects.get(first.key).reportText).generationId,'gen_current');
}));
test('missing, failed, duplicate or changed market preparation cannot pass',async()=>{
 for(const mutate of [r=>r.results.pop(),r=>{r.results[0].status='failure';},r=>{r.results[0].market='korea';},r=>{r.markets.push('japan');},r=>{r.generationId='stale';}])await fixture(async({options,writes})=>{
  const report=structuredClone(valid);mutate(report);fs.writeFileSync(options.filename,JSON.stringify(report));
  await assert.rejects(preserveEvidence(options));assert.equal(writes.length,0);
 });
});
test('missing successful report fails; an unstarted step can have no report',()=>fixture(async({options,writes})=>{
 fs.unlinkSync(options.filename);await assert.rejects(preserveEvidence(options),/successful_step_missing_evidence/);
 assert.deepEqual(await preserveEvidence({...options,required:false}),{name:'market-preparation',produced:false});assert.equal(writes.length,0);
}));
test('storage write failure, readback corruption and conflicting evidence fail closed',async()=>{
 await fixture(async({options})=>{options.storage.writeJson=async()=>{throw Error('offline');};await assert.rejects(preserveEvidence(options),/offline/);});
 await fixture(async({options})=>{const read=options.storage.readJson;options.storage.readJson=async key=>key==='catalog/manifest.json'?read(key):{};await assert.rejects(preserveEvidence(options),/release_evidence_readback_mismatch/);});
 await fixture(async({options,objects})=>{const first=await preserveEvidence(options);objects.get(first.key).reportSha256='changed';await assert.rejects(preserveEvidence(options),/release_evidence_readback_mismatch/);});
});
test('browser evidence requires the exact release and all unchanged verdicts',async()=>{
 for(const mutate of [r=>{r.release='c'.repeat(40);},r=>{r.passed=false;},r=>{r.browserPassed=false;},r=>{r.speedGuard.passed=false;}])await fixture(async({options,writes})=>{
  const report={release,passed:true,browserPassed:true,speedGuard:{passed:true}};mutate(report);fs.writeFileSync(options.filename,JSON.stringify(report));
  await assert.rejects(preserveEvidence({...options,name:'browser-acceptance'}));assert.equal(writes.length,0);
 });
});
test('successful browser evidence preserves the exact original JSON bytes',()=>fixture(async({options,objects})=>{
 const raw=JSON.stringify({release,passed:true,browserPassed:true,speedGuard:{passed:true},label:'Проверка города'},null,2)+'\n';
 fs.writeFileSync(options.filename,raw);
 const receipt=await preserveEvidence({...options,name:'browser-acceptance'});
 assert.equal(objects.get(receipt.key).reportText,raw);
 assert.deepEqual(JSON.parse(objects.get(receipt.key).reportText).speedGuard,{passed:true});
}));
test('attempts have separate immutable locations and unsafe metadata never writes',()=>fixture(async({options,objects,writes})=>{
 await preserveEvidence(options);await preserveEvidence({...options,attempt:'2'});assert.equal(objects.size,2);
 const before=writes.length;
 for(const change of [{name:'../escape'},{release:'main'},{runId:'../123'},{attempt:'0'},{calculationVersion:'unknown'},{storage:{...options.storage,driver:'local'}}])await assert.rejects(preserveEvidence({...options,...change}));
 assert.equal(writes.length,before);
}));

test('every optional GitHub mirror follows mandatory private evidence and source-bound outcomes',()=>{
 // Match step declarations, not historical step-name references inside guards.
 const steps=controller.split(/(?=^      - (?:name|uses|run):)/m);
 const mappings=[
  ['private_index','Preserve existing encyclopedia coverage and batch membership'],
  ['market_prices','Preserve individual market preparation results'],
  ['deploy_acceptance','Preserve required browser acceptance evidence'],
  ['public_verification','Preserve public encyclopedia verification'],
 ];
 const privateSteps=steps.filter(step=>/^      - name: Persist verified private evidence for /m.test(step));
 assert.equal(privateSteps.length,4);
 assert.equal((controller.match(/^        uses: actions\/upload-artifact@v4$/gm)||[]).length,4);
 for(const [source,mirrorName] of mappings){
  const evidence=steps.find(step=>step.startsWith('      - name: Persist verified private evidence for '+source+'\n'));
  const produced=steps.find(step=>new RegExp('^        id: '+source+'$','m').test(step));
  const mirror=steps.find(step=>step.startsWith('      - name: '+mirrorName+'\n'));
  assert.ok(evidence&&produced&&mirror);
  assert.ok(steps.indexOf(produced)<steps.indexOf(evidence));
  assert.equal(steps.indexOf(mirror),steps.indexOf(evidence)+1);
  assert.match(evidence,/^        if: always\(\)$/m);
  assert.doesNotMatch(evidence,/continue-on-error:/);
  assert.ok(evidence.includes('REQUIRE_EVIDENCE: ${{ steps.'+source+".outcome == 'success' }}"));
  assert.match(mirror,/^        timeout-minutes: 2$/m);
  assert.match(mirror,/^        continue-on-error: true$/m);
  assert.match(mirror,/^        uses: actions\/upload-artifact@v4$/m);
 }
 assert.equal((controller.match(/previous release not terminal/g)||[]).length,3);
 assert.equal((controller.match(/retained release changed/g)||[]).length,3);
});
