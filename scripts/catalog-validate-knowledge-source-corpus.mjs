import fs from "node:fs/promises";
import path from "node:path";

const ROOT=path.resolve(process.env.KNOWLEDGE_SNAPSHOT_ROOT||"data/catalog/knowledge-source-snapshots/generated");
const DEN=path.resolve(process.env.KNOWLEDGE_DENOMINATOR_ROOT||"data/catalog/knowledge-source-snapshots/denominator");
const MASTER=path.resolve(process.env.KNOWLEDGE_MASTER_ROOT||"data/catalog/knowledge-source-snapshots/master");
const REPORT=path.resolve(process.env.KNOWLEDGE_COMPLETION_REPORT||"data/catalog/knowledge-source-snapshots/completion-report.json");
async function read(file){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch(error){return{__missing:true,__file:file,__error:String(error?.message||error)}}}
const global=await read(path.join(DEN,"coverage-report.json"));
const west=await read(path.join(DEN,"western-coverage-report.json"));
const asia=await read(path.join(DEN,"asia-coverage-report.json"));
const master=await read(path.join(MASTER,"manifest.json"));
const vehicles=await read(path.join(ROOT,"vehiclesdb","snapshot-manifest.json"));
const eea=await read(path.join(ROOT,"eea","snapshot-manifest.json"));
const miit=await read(path.join(ROOT,"miit","products-manifest.json"));
const mlit=await read(path.join(ROOT,"mlit","tabular-manifest.json"));
const mlitContext=await read(path.join(ROOT,"mlit","attachment-context-report.json"));
const korea=await read(path.join(ROOT,"korea","jeju-registry-manifest.json"));
const koreaEnergy=await read(path.join(ROOT,"korea","energy-agency-manifest.json"));
const us=await read(path.join(ROOT,"us","snapshot-manifest.json"));
const canada=await read(path.join(ROOT,"canada","snapshot-manifest.json"));
const china=await read(path.join(ROOT,"autohome-china","snapshot-manifest.json"));
const failures=[];const checks=[];
function check(id,actual,predicate,expected){const ok=!actual?.__missing&&Boolean(predicate(actual));checks.push({id,ok,expected,actual:actual?.__missing?{missing:true,file:actual.__file,error:actual.__error}:actual});if(!ok)failures.push(id);}
check("vehiclesdb_denominator",vehicles,v=>Number(v.counts?.makes||0)>=200&&Number(v.counts?.models||0)>=4000,"makes>=200 models>=4000");
check("global_denominator",global,v=>Number(v.counts?.sourceModels||0)>=4000&&Number(v.counts?.sourceBrands||0)>=200,"sourceModels>=4000 sourceBrands>=200");
check("source_master",master,v=>Number(v.counts?.models||0)>=5000&&Number(v.counts?.brands||0)>=200,"one master with models>=5000 brands>=200");
check("eea_2020_2025",eea,v=>[2020,2021,2022,2023,2024,2025].every(y=>Number(v.counts?.[`year${y}`]||0)>0)&&Number(v.counts?.technicalTuples||0)>=10000,"every year 2020..2025 nonzero and technicalTuples>=10000");
check("western_denominator",west,v=>Number(v.counts?.sourceModels||0)>=500&&Number(v.counts?.variantEvidence||0)>=1000&&Number(v.counts?.usFuelEconomyRowsIncluded||0)>=1000,"models>=500 evidence>=1000 EPA2020+>=1000");
check("us_government_snapshot",us,v=>Number(v.counts?.fuelEconomyRows||0)>=1000&&Number(v.counts?.nhtsaCurrentMakeResponses||0)>=25&&Number(v.counts?.nhtsaCurrentModels||0)>=500,"EPA rows>=1000 NHTSA make responses>=25 models>=500");
check("canada_government_snapshot",canada,v=>Number(v.counts?.rows||0)>=1000,"NRCan rows>=1000");
check("miit_china_products",miit,v=>Number(v.counts?.products||0)>=1000&&Number(v.counts?.batchesRequested||0)===81&&Number(v.counts?.batchesComplete||0)===81&&Number(v.counts?.blockedBatches||0)===0&&Number(v.counts?.failedBatches||0)===0&&v.status==="complete_bounded_batch_sample","MIIT bounded products>=1000 and every live queryable batch 328..408 sampled with no block/failure; this check does not claim an exhaustive MIIT mirror");
check("china_model_variants",china,v=>Number(v.counts?.brands||0)>=50&&Number(v.counts?.series||0)>=200&&Number(v.counts?.variants2020Plus||0)>=500,"brands>=50 series>=200 variants2020+>=500");
check("korea_registration",korea,v=>{const c=v.counts||{},accepted=Number(c.rowsIn2020Plus||0),explicit=Number(c.rowsWithExplicitModelYear||0),registration=Number(c.rowsWithFirstRegistrationWindowOnly||0);return Number(c.rowsParsed||0)>=100000&&accepted>=1000&&Number(c.uniqueTuples||0)>=1000&&accepted===explicit+registration;},"rows>=100000 accepted 2020+ evidence>=1000 unique tuples>=1000 and every accepted row has an explicit model-year or first-registration-year basis");
check("korea_energy",koreaEnergy,v=>Number(v.counts?.models||0)>=1000,"models>=1000");
check("mlit_attachment_context",mlitContext,v=>Number(v.attachments||0)>=100&&Number(v.withSourcePageTitle||0)>=50,"attachments>=100 with page title>=50");
check("mlit_tabular",mlit,v=>Number(v.converted||0)>=5&&Number(v.selected||0)>=5,"converted>=5 selected>=5");
check("asia_denominator",asia,v=>Number(v.counts?.models||0)>=1000&&Number(v.counts?.chinaVariants||0)>=500&&Number(v.counts?.koreaEnergyModels||0)>=1000&&Number(v.counts?.japanMlitRows||0)>=200,"models>=1000 China variants>=500 Korea models>=1000 Japan rows>=200");
const compactChecks=checks.map(c=>({id:c.id,ok:c.ok,expected:c.expected,counts:c.actual?.counts||null,status:c.actual?.status||null,summary:c.id==="mlit_attachment_context"?{attachments:c.actual?.attachments,withSourcePageTitle:c.actual?.withSourcePageTitle}:c.id==="mlit_tabular"?{selected:c.actual?.selected,converted:c.actual?.converted,failed:c.actual?.failed}:null}));
const report={schemaVersion:1,builtAt:new Date().toISOString(),ready:failures.length===0,coverageContract:{japan:"2010-present",allOtherProductionMarkets:"2020-present",westernEvidenceMarkets:["us","canada"],truthRule:"Missing, truncated or blocked source data never counts as complete."},failures,checks:compactChecks,headline:{masterBrands:Number(master.counts?.brands||0),masterModels:Number(master.counts?.models||0),masterModelsWithCanonicalV2:Number(master.counts?.modelsWithCanonicalV2||0),globalSourceBrands:Number(global.counts?.sourceBrands||0),globalSourceModels:Number(global.counts?.sourceModels||0),globalVariantEvidence:Number(global.counts?.sourceVariantEvidence||0),westernSourceModels:Number(west.counts?.sourceModels||0),westernVariantEvidence:Number(west.counts?.variantEvidence||0),asiaSourceModels:Number(asia.counts?.models||0),asiaVariantEvidence:Number(asia.counts?.evidence||0),chinaVariants:Number(asia.counts?.chinaVariants||0),koreaJejuTuples:Number(asia.counts?.koreaJejuTuples||0),koreaEnergyModels:Number(asia.counts?.koreaEnergyModels||0),japanMlitRows:Number(asia.counts?.japanMlitRows||0),miitProducts:Number(asia.counts?.miitProducts||0)}};
await fs.mkdir(path.dirname(REPORT),{recursive:true});await fs.writeFile(REPORT,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(!report.ready)throw new Error(`knowledge_source_corpus_incomplete:${failures.join(",")}`);

