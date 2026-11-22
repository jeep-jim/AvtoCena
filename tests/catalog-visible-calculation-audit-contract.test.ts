import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {writeCatalogProjectionBatches} from "../apps/web/lib/catalog-projection-parts";

const audit = fs.readFileSync(new URL("../scripts/catalog-audit-visible-calculation-coverage.mjs", import.meta.url), "utf8");
const publicPriority = fs.readFileSync(new URL("../apps/web/lib/catalog/public-priority.ts", import.meta.url), "utf8");

test("visible calculation audit accepts safely hidden estimated inventory without weakening price safety", () => {
  assert.match(audit, /specificationRejection = catalogRequiredSpecificationRejectionReason\(offer\)/);
  assert.match(audit, /if \(specificationRejection\) return \{/);
  assert.doesNotMatch(audit, /scenario\?\.requiresConfirmation === true \|\| \/\^power_scenario:\//);
  assert.match(audit, /catalogOfferVisibleRub\(offer\)/);
  assert.match(audit, /const safelyHiddenEstimated = status === "estimated" && visibleRub === 0 && identityResolved;/);
  assert.match(audit, /if \(safelyHiddenEstimated\) \{[\s\S]*increment\(needsDataModels/);
  assert.match(audit, /pass: invalidReady\.length === 0[\s\S]*allIdentitiesResolved[\s\S]*unsafePendingVisiblePrices\.length === 0/);
  assert.match(audit, /fallback100PublicCount/);
  assert.match(audit, /unprovenExact100PublicCount/);
  assert.match(audit, /noFallback100PublicCards/);
  assert.match(publicPriority, /if \(catalogRequiredSpecificationRejectionReason\(offer\)\) return 0;/);
});

const repository=path.resolve(import.meta.dirname,'..');
const generationId='gen_1795342198136_a17e031f';
const script=path.join(repository,'scripts/catalog-audit-visible-calculation-coverage.mjs');

function projection(id:string,market:string) {
  return {id,market,make:'Kia',model:'Morning',year:new Date().getUTCFullYear()-2,
    updatedAt:new Date().toISOString(),cardImageUrl:'https://example.test/car.jpg',
    calculationStatus:'ready',cardProjectionVersion:3,publicSpecificationVerified:true,
    publicVisibleRub:1200000,totalRub:1200000,powertrainKind:'combustion',
    engineCc:998,powerHp:76,fuel:'petrol',powerDataConfidence:'source_exact'};
}

async function fixture(includeNonvisible=false) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'visible-market-audit-'));
  const korea:Array<ReturnType<typeof projection>&{sourceGroup?:string}>=[projection('kr-good','korea')];
  if(includeNonvisible) korea.push(
    {...projection('kr-hidden','korea'),make:'Unknown'},
    {...projection('kr-retired','korea'),make:'Unknown',sourceGroup:'jptrade'},
    {...projection('kr-old','korea'),make:'Unknown',year:new Date().getUTCFullYear()-10},
  );
  const europe=[{...projection('eu-invalid','europe'),make:'Unknown'}];
  const keys:Record<string,string[]>={korea:[],europe:[]};
  const put=(key:string,value:unknown)=>{
    const file=path.join(directory,'data',key);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));
  };
  const manifest={version:2,generationId,markets:{
    korea:{count:korea.length,chunks:['001']},europe:{count:europe.length,chunks:['001']},
  }};
  put('catalog/manifest.json',manifest);
  put('catalog-editorial/current.json',{revision:'test',entries:includeNonvisible?{
    'kr-hidden':{id:'kr-hidden',market:'korea',status:'hidden'},
  }:{}});
  for(const [market,rows] of Object.entries({korea,europe})) {
    const key='catalog/generations/'+generationId+'/indexes/projection/'+market+'.json';
    await writeCatalogProjectionBatches({writeJson:async(k:string,v:unknown)=>{keys[market].push(k);put(k,v);}} as any,key,generationId,[rows]);
  }
  put('catalog/public/facets.json',{generationId,makes:[],models:[],markets:['korea','europe']});
  put('catalog/public/projection/all.json',{generationId,items:[...korea,...europe]});
  return {directory,keys,put,korea,europe,manifest};
}

function runAudit(directory:string,args:string[],allowedKeys?:string[],manifestSequence?:unknown[]) {
  const output=path.join(directory,'report.json'), readsFile=path.join(directory,'reads.json');
  fs.rmSync(output,{force:true});
  const preload=path.join(directory,'capture-reads.mjs');
  fs.writeFileSync(preload,[
    "import fs from 'node:fs';",
    'const {LocalJsonStorage}=await import('+JSON.stringify(pathToFileURL(path.join(repository,'apps/web/lib/data.ts')).href)+');',
    'const allowed='+JSON.stringify(allowedKeys??null)+';const reads=[];',
    'const manifests='+JSON.stringify(manifestSequence??null)+';let manifestRead=0;',
    'for(const method of ["readJsonWithMeta","getBinary"]){',
    ' const original=LocalJsonStorage.prototype[method];',
    ' LocalJsonStorage.prototype[method]=async function(key,...args){',
    '  reads.push(key);if(allowed&&!allowed.includes(key))throw Error("unexpected_other_market_read:"+key);',
    '  if(method==="readJsonWithMeta"&&key==="catalog/manifest.json"&&manifests)',
    '   fs.writeFileSync('+JSON.stringify(path.join(directory,'data/catalog/manifest.json'))+',JSON.stringify(manifests[Math.min(manifestRead++,manifests.length-1)]));',
    '  return original.call(this,key,...args);',
    ' };',
    '}',
    'process.on("exit",()=>fs.writeFileSync('+JSON.stringify(readsFile)+',JSON.stringify(reads)));',
  ].join('\n'));
  const result=spawnSync(process.execPath,[
    '--import',createRequire(import.meta.url).resolve('tsx'),
    '--import',path.join(repository,'tests/helpers/offline-fetch.mjs'),
    '--import',preload,script,...args,
  ],{cwd:directory,env:{...process.env,JSON_STORAGE_DRIVER:'local',
    CATALOG_VISIBLE_CALCULATION_AUDIT_OUTPUT:output,GITHUB_OUTPUT:path.join(directory,'outputs'),
    TSX_TSCONFIG_PATH:path.join(repository,'apps/web/tsconfig.json')},
    encoding:'utf8',timeout:30000,maxBuffer:512*1024});
  return {...result,report:fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null,
    reads:fs.existsSync(readsFile)?JSON.parse(fs.readFileSync(readsFile,'utf8')):[]};
}

test('actual CLI isolates valid Korea from invalid Europe, while Europe and legacy global audits fail',async()=>{
  const f=await fixture(true);
  try {
    const korea=runAudit(f.directory,['--market=korea'],['catalog/manifest.json','catalog-editorial/current.json',...f.keys.korea]);
    assert.equal(korea.status,0,korea.stderr);
    assert.deepEqual(korea.report.scope,{kind:'market',market:'korea'});
    assert.equal(korea.report.releaseGate.pass,true);
    assert.deepEqual(korea.report.globalReleaseGate,{audited:false,pass:null});
    assert.deepEqual(Object.keys(korea.report.byMarket),['korea']);
    assert.equal(korea.report.totals.visibleOffers,1,'hidden, retired and expired target rows retain the default reader visibility');
    assert.ok(korea.reads.includes(f.keys.korea[0]),'real bounded projection part was read');
    const europe=runAudit(f.directory,['--market','europe'],['catalog/manifest.json','catalog-editorial/current.json',...f.keys.europe]);
    assert.equal(europe.status,1,europe.stderr);
    assert.equal(europe.report.releaseGate.allIdentitiesResolved,false);
    assert.equal(europe.report.releaseGate.pass,false);
    const global=runAudit(f.directory,[]);
    assert.equal(global.status,1,global.stderr);
    assert.deepEqual(global.report.scope,{kind:'global'});
    assert.deepEqual(global.report.globalReleaseGate,{audited:true,pass:false});
    assert.equal(global.report.totals.visibleOffers,2);
    assert.equal(global.report.byMarket.europe.unresolvedIdentity,1);
    const workflow=fs.readFileSync(path.join(repository,'.github/workflows/catalog-market-refresh.yml'),'utf8');
    assert.ok(workflow.includes("catalog-audit-visible-calculation-coverage.mjs --market '"+'$'+"{{ matrix.market }}'"));
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('target audit keeps the actual invalid-ready price gate',async()=>{
  const f=await fixture();
  try {
    const key='catalog/generations/'+generationId+'/indexes/projection/korea.json';
    f.put(key,{generationId,items:[{...f.korea[0],totalRub:0}]});
    const result=runAudit(f.directory,['--market=korea'],['catalog/manifest.json','catalog-editorial/current.json',key]);
    assert.equal(result.status,1,result.stderr);
    assert.equal(result.report.releaseGate.noInvalidReady,false);
    assert.equal(result.report.releaseGate.pass,false);
    assert.ok(result.report.invalidReady[0].reasons.includes('missing_total_rub'));
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('unknown, repeated, missing and unrelated CLI arguments fail before catalog reads',async()=>{
  const f=await fixture();
  try {
    for(const args of [['--market=any'],['--market=unknown'],['--market=korea','--market','korea'],
      ['--market'],['--market='],['--other=korea']]) {
      const result=runAudit(f.directory,args,[]);
      assert.equal(result.status,1,args.join(' ')+': '+result.stderr);
      assert.match(result.stderr,/visible_audit_(market_invalid|market_repeated|argument_invalid)/);
      assert.equal(result.report,null);
      assert.deepEqual(result.reads,[]);
    }
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('a foreign row in the selected market projection cannot be silently filtered into a pass',async()=>{
  const f=await fixture();
  try {
    const key='catalog/generations/'+generationId+'/indexes/projection/korea.json';
    f.put(key,{generationId,items:[projection('foreign','europe')]});
    const result=runAudit(f.directory,['--market=korea'],['catalog/manifest.json',key]);
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/visible_audit_projection_identity/);
    assert.equal(result.report,null);
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});

test('a neighbouring publication passes target readback only when the target rows are unchanged',async()=>{
  const f=await fixture();
  try {
    const nextGeneration='gen_1795342198137_b17e031f';
    const nextManifest={...f.manifest,generationId:nextGeneration,
      markets:{...f.manifest.markets,europe:{count:2,chunks:['001','002']}}};
    const key='catalog/generations/'+nextGeneration+'/indexes/projection/korea.json';
    for(const changed of [false,true]) {
      f.put(key,{generationId:nextGeneration,items:changed?[{...f.korea[0],powerHp:77}]:f.korea});
      const result=runAudit(f.directory,['--market=korea'],
        ['catalog/manifest.json','catalog-editorial/current.json',...f.keys.korea,key],
        [f.manifest,nextManifest,nextManifest]);
      if(changed) {
        assert.equal(result.status,1,result.stderr);
        assert.match(result.stderr,/visible_audit_target_changed/);
        assert.equal(result.report,null);
      } else {
        assert.equal(result.status,0,result.stderr);
        assert.equal(result.report.releaseGate.pass,true);
        assert.equal(result.report.totals.generationId,generationId);
        assert.equal(result.report.totals.observedGenerationId,nextGeneration);
        assert.ok(result.reads.includes(key),'new target projection was actually verified');
      }
    }
  } finally {fs.rmSync(f.directory,{recursive:true,force:true});}
});
