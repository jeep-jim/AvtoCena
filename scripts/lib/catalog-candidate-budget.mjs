import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {PREPARED_MARKETS, budgetManifestMarkets, stagedBudgetDigest as hash, verifyBudgetSourceCoverage,
  assertBudgetReadinessReport, assertBudgetSourceSupplement, assertBudgetSourceSupplementPlan,
  assertBudgetSourceSupplementObject} from './catalog-staged-budget.mjs';

const HEX=/^[a-f0-9]{64}$/, SHA=/^[a-f0-9]{40}$/, MAX_PART_BYTES=4*1024*1024, MAX_PRICE_BYTES=64*1024*1024;
export const candidateControlsKey='catalog/operations/collection-controls-v1.json';
export function candidateControlsRevision(meta) {
  if(meta?.found===true&&!meta.etag)throw Error('candidate_budget_controls_etag_required');
  return {found:meta?.found===true,etag:meta?.etag||null,digest:hash(meta?.value??null)};
}

/** All paths are derived before the first write. A candidate can never write a
 * generic selector, another calculator's prefix or an arbitrary price hash. */
export function candidateBudgetContract(context, inputs) {
  const markets=budgetManifestMarkets(context.manifest), baseline=context.baselineLiveIdentity;
  if(PREPARED_MARKETS.some(market=>!Object.hasOwn(context.manifest.markets,market)))throw Error('candidate_budget_market_manifest_incomplete');
  if(!SHA.test(context.release||'')||!SHA.test(baseline?.release||'')||!HEX.test(context.calculationVersion||'')||!HEX.test(context.encyclopediaDigest||'')
      ||!HEX.test(baseline?.calculationVersion||'')||context.calculationVersion===baseline.calculationVersion
      ||context.release===baseline.release)throw Error('candidate_budget_namespace_not_isolated');
  if(JSON.stringify(Object.keys(inputs).sort())!==JSON.stringify(markets.slice().sort()))throw Error('candidate_budget_source_contract_incomplete');
  const contract={version:1,release:context.release,calculationVersion:context.calculationVersion,
    encyclopediaDigest:context.encyclopediaDigest,generationId:context.manifest.generationId,
    manifestDigest:hash(context.manifest),
    specificationPrefix:`catalog/generations/${context.manifest.generationId}/indexes/budget-markets-v7/${hash([context.encyclopediaDigest,context.calculationVersion])}/`,
    markets:{}};
  for(const market of markets){
    const input=inputs[market];
    if(!HEX.test(input?.fingerprint||'')||!HEX.test(input?.sourceIds||'')||!Number.isSafeInteger(input?.sourceRows)||input.sourceRows<=0
        ||input.sourceRows>context.manifest.markets[market].count||input.coverage?.projectionRows!==context.manifest.markets[market].count
        ||input.coverage?.selectorRows!==input.sourceRows)throw Error('candidate_budget_source_contract_invalid');
    if(input.sourceSupplement!==undefined)assertBudgetSourceSupplement(input.sourceSupplement,context,market,input);
    const key=hash([context.manifest.generationId,market,input.fingerprint]);
    contract.markets[market]={...input,selectionKey:key,selectionPrefix:`catalog/runtime-budget-selections-v1/${market}/${key}/`,
      budgetPath:`catalog/runtime-budget-prices-v3/${market}/${hash([context.manifest.generationId,market,input.fingerprint,input.sourceIds])}.json`,
      sortPath:`catalog/runtime-sort-prices-v3/${market}/${hash([context.manifest.generationId,market,input.fingerprint,input.sourceIds,'display-price-v2'])}.json`};
  }
  const supplemented=markets.filter(market=>inputs[market].sourceSupplement!==undefined).length;
  if(supplemented!==0&&supplemented!==markets.length)throw Error('candidate_budget_source_contract_incomplete');
  return contract;
}

export function assertCandidateBudgetContract(contract,context) {
  const inputs=Object.fromEntries(Object.entries(contract?.markets||{}).map(([market,row])=>[market,
    {fingerprint:row.fingerprint,sourceIds:row.sourceIds,sourceRows:row.sourceRows,coverage:row.coverage,
      ...(row.sourceSupplement!==undefined?{sourceSupplement:row.sourceSupplement}:{})}]));
  if(hash(contract)!==hash(candidateBudgetContract(context,inputs)))throw Error('candidate_budget_contract_invalid');
}

export async function readCandidateBudgetContract(root,storage,context) {
  const runtime=relative=>import(pathToFileURL(path.join(root,relative)).href);
  const [catalog,pricing,publication,encyclopedia]=await Promise.all([runtime('apps/web/lib/catalog/storage.ts'),
    runtime('apps/web/lib/catalog/shared-budget-prices.ts'),runtime('apps/web/lib/catalog/budget-selector-publication.ts'),
    runtime('apps/web/lib/encyclopedia/calculation-index.ts')]);
  if(typeof catalog.verifyPreparedBudgetPriceCaches!=='function')throw Error('candidate_budget_prepared_reader_required');
  const supplements=typeof catalog.readBudgetSpecificationSource==='function';
  if(supplements!==(typeof catalog.verifyBudgetSpecificationSource==='function')
      ||supplements&&typeof catalog.prepareBudgetSpecificationSourceRows!=='function')throw Error('candidate_budget_supplement_api_incomplete');
  if(pricing.calculationCacheVersion()!==context.calculationVersion||encyclopedia.readCalculationIndex()?.digest!==context.encyclopediaDigest) {
    throw Error('candidate_budget_runtime_context_mismatch');
  }
  const prefix=`catalog/generations/${context.manifest.generationId}/indexes/budget-markets-v3/`;
  const directory=await storage.readJson(prefix+'ready.json',null),inputs={};
  if(directory?.generationId!==context.manifest.generationId)throw Error('candidate_budget_base_selector_missing');
  for(const market of budgetManifestMarkets(context.manifest)){
    const baseline=await publication.readCompressedSelector(directory,market,name=>storage.readJson(prefix+name+'.json',null));
    if(!baseline||baseline.version!==3||baseline.generationId!==context.manifest.generationId
        ||baseline.sourceRows!==baseline.rows.length+(baseline.otherRows?.length||0))throw Error('candidate_budget_base_selector_incomplete');
    const plan=supplements?await catalog.readBudgetSpecificationSource(context.manifest,market):null;
    if(supplements&&!plan)throw Error('candidate_budget_source_contract_incomplete');
    const index=plan?.index||baseline;
    const source=[...index.rows,...(index.otherRows||[])];
    if(index.sourceRows!==source.length||source.some(row=>row[0]!==market))throw Error('candidate_budget_base_selector_incomplete');
    const fingerprint=await pricing.budgetPricingFingerprint(market);
    const projection=await storage.readJson(`catalog/generations/${context.manifest.generationId}/indexes/projection/${market}.json`,null);
    const coverage=verifyBudgetSourceCoverage({manifest:context.manifest,market,projection,source,
      prepareRows:supplements?catalog.prepareBudgetSpecificationSourceRows:catalog.prepareCatalogProjectionRows});
    inputs[market]={fingerprint,sourceIds:hash(source.map(row=>row[5].id)),sourceRows:source.length,coverage};
    if(plan)inputs[market].sourceSupplement=assertBudgetSourceSupplementPlan(plan,context,market,baseline,coverage);
  }
  if(pricing.calculationCacheVersion()!==context.calculationVersion||encyclopedia.readCalculationIndex()?.digest!==context.encyclopediaDigest) {
    throw Error('candidate_budget_runtime_context_mismatch');
  }
  return candidateBudgetContract(context,inputs);
}

function priceValue(wire) {
  if(wire?.encoding!=='gzip-base64')return wire;
  if(typeof wire.payload!=='string'||wire.payload.length>MAX_PRICE_BYTES*2)throw Error('candidate_budget_price_wire_invalid');
  const raw=Buffer.from(wire.payload,'base64');if(raw.toString('base64')!==wire.payload)throw Error('candidate_budget_price_wire_invalid');
  try{return JSON.parse(gunzipSync(raw,{maxOutputLength:MAX_PRICE_BYTES}).toString('utf8'));}
  catch{throw Error('candidate_budget_price_wire_invalid');}
}

export function candidateBudgetWriteKind(contract,key,value) {
  const fail=()=>{throw Error('candidate_budget_write_forbidden');};
  if(typeof key!=='string'||!value||typeof value!=='object')return fail();
  const small=()=>{if(Buffer.byteLength(JSON.stringify(value))>MAX_PART_BYTES)fail();};
  const part=(suffix,market)=>{
    const match=suffix.match(new RegExp(`^parts/${market}/([a-f0-9]{64})\\.json$`));
    if(!match||value.encoding!=='gzip-base64'||typeof value.payload!=='string'||hash(value)!==match[1])return false;
    small();return true;
  };
  for(const expected of Object.values(contract.markets)){
    const descriptor=expected.sourceSupplement;
    const object=descriptor?.objects.find(row=>key===`catalog/generations/${contract.generationId}/indexes/${row.path}`);
    if(object){
      try{assertBudgetSourceSupplementObject(descriptor,object,value);}catch{return fail();}
      return 'source-supplement';
    }
  }
  if(key.startsWith(contract.specificationPrefix)){
    const suffix=key.slice(contract.specificationPrefix.length);
    if(suffix==='ready.json'){
      small();
      if(value.version!==4||value.generationId!==contract.generationId||value.encyclopediaDigest!==contract.encyclopediaDigest
          ||!value.markets||Object.keys(value.markets).some(market=>market!=='japan'&&!contract.markets[market]))return fail();
      return 'specification-ready';
    }
    for(const market of Object.keys(contract.markets))if(part(suffix,market))return 'content-addressed-part';
    return fail();
  }
  for(const [market,expected]of Object.entries(contract.markets)){
    if(key===expected.budgetPath||key===expected.sortPath){
      if(Buffer.byteLength(JSON.stringify(value))>MAX_PRICE_BYTES*2)return fail();
      const row=priceValue(value),priceKey=key.split('/').at(-1).slice(0,-5);
      if(row?.version!==1||row.key!==priceKey||row.sourceIds!==expected.sourceIds||!Array.isArray(row.prices)
          ||row.prices.length>expected.sourceRows||row.checksum!==hash(row.prices))return fail();
      return 'numeric-price';
    }
    if(key.startsWith(expected.selectionPrefix)){
      const suffix=key.slice(expected.selectionPrefix.length);
      if(part(suffix,market))return 'content-addressed-part';
      if(suffix!=='ready.json')return fail();
      small();const {checksum,...body}=value;
      if(value.version!==1||value.generationId!==contract.generationId||value.market!==market||value.fingerprint!==expected.fingerprint
          ||value.key!==expected.selectionKey||value.sourceIds!==expected.sourceIds||value.sourceRows!==expected.sourceRows||checksum!==hash(body))return fail();
      return 'selection-ready';
    }
  }
  return fail();
}

/** Strengthen old disposable-cache writers with CAS without changing their
 * calculator. Conflicting candidate writes fail or are independently reread. */
export async function persistCandidateBudgetObject({contract,key,value,condition,read,write,ConflictError}) {
  const kind=candidateBudgetWriteKind(contract,key,value),current=await read(key,null);
  if(kind==='specification-ready'&&hash(value.markets?.japan??null)!==hash(current.value?.markets?.japan??null)) {
    throw Error('candidate_budget_japan_partition_changed');
  }
  if(current.found&&hash(current.value)===hash(value))return;
  if(kind==='source-supplement'&&current.found)throw Error('candidate_budget_immutable_source_conflict');
  if(current.found&&!current.etag)throw Error('candidate_budget_etag_required');
  if(condition?.ifNoneMatch==='*'&&current.found||condition?.ifMatch&&condition.ifMatch!==current.etag)throw new ConflictError();
  return write(key,value,current.found?{ifMatch:current.etag}:{ifNoneMatch:'*'});
}

export function candidateBudgetCore(report,context,contract) {
  assertBudgetReadinessReport(report,context);
  if(contract.release!==context.release||contract.calculationVersion!==context.calculationVersion
      ||contract.encyclopediaDigest!==context.encyclopediaDigest||contract.generationId!==context.manifest.generationId
      ||contract.manifestDigest!==hash(context.manifest)||!context.controlsRevision)throw Error('candidate_budget_receipt_context_invalid');
  if(report.preparedSelections?.verified!==true||report.preparedSelections.generationId!==context.manifest.generationId)throw Error('candidate_budget_prepared_selection_missing');
  for(const [market,expected]of Object.entries(contract.markets)){
    const actual=report.markets[market];
    if(actual?.fingerprint!==expected.fingerprint||actual.sourceIds!==expected.sourceIds||actual.sourceRows!==expected.sourceRows
        ||hash(actual.coverage)!==hash(expected.coverage)
        ||hash(actual.sourceSupplement??null)!==hash(expected.sourceSupplement??null))throw Error('candidate_budget_readback_contract_changed');
  }
  return {version:1,release:context.release,calculationVersion:context.calculationVersion,encyclopediaDigest:context.encyclopediaDigest,
    baselineLiveIdentity:context.baselineLiveIdentity,generationId:context.manifest.generationId,
    manifestEtag:context.manifestEtag,manifestDigest:hash(context.manifest),controlsRevision:context.controlsRevision,
    utcDay:report.utcDay,policyDay:report.policyDay,markets:report.markets,preparedSelections:report.preparedSelections,contract};
}

export function assertCandidateBudgetReceipt(expected,actual,expectedDigest) {
  if(!HEX.test(expectedDigest||'')||expected?.receiptSha256!==expectedDigest||hash(expected.core)!==expectedDigest
      ||hash(actual)!==expectedDigest)throw Error('candidate_budget_receipt_changed');
}
