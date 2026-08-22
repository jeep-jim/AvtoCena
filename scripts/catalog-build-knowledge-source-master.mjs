import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEN=path.resolve(process.env.KNOWLEDGE_DENOMINATOR_ROOT||"data/catalog/knowledge-source-snapshots/denominator");
const OUT=path.resolve(process.env.KNOWLEDGE_MASTER_ROOT||"data/catalog/knowledge-source-snapshots/master");
const CHUNK=Math.max(100,Math.min(500,Number(process.env.KNOWLEDGE_MASTER_CHUNK_SIZE||250)));
const clean=v=>String(v??"").normalize("NFKC").replace(/\s+/g," ").trim();
const norm=v=>clean(v).toLowerCase().replace(/&/g,"and").replace(/\+/g,"plus").replace(/[^a-z0-9\p{L}\p{N}]+/gu,"");
const hash=v=>crypto.createHash("sha256").update(v).digest("hex");
const uniq=arr=>[...new Set((arr||[]).map(clean).filter(Boolean))];
async function list(prefix){try{return(await fs.readdir(DEN)).filter(n=>n.startsWith(prefix)&&n.endsWith('.json')).sort();}catch{return[];}}
async function readRows(prefix){const out=[];for(const name of await list(prefix)){try{const p=JSON.parse(await fs.readFile(path.join(DEN,name),'utf8'));out.push(...(p.records||[]));}catch{}}return out;}
async function writeChunks(prefix,type,rows){const files=[];for(let i=0;i<rows.length;i+=CHUNK){const n=Math.floor(i/CHUNK)+1,name=`${prefix}-${String(n).padStart(4,'0')}.json`;await fs.writeFile(path.join(OUT,name),JSON.stringify({schemaVersion:1,entityType:type,chunk:n,maxRecords:CHUNK,records:rows.slice(i,i+CHUNK)},null,2)+'\n');files.push(name);}return files;}

await fs.rm(OUT,{recursive:true,force:true});await fs.mkdir(OUT,{recursive:true});
const global=await readRows('models-');
const western=await readRows('western-models-');
const asia=await readRows('asia-models-');
const modelMap=new Map();
function mergeModel(row,origin){const make=clean(row.make||row.canonical?.canonicalMake||'');const model=clean(row.model||row.canonical?.canonicalModel||'');if(!model)return;const market=clean(row.market||'');const key=make?`${norm(make)}:${norm(model)}`:`local:${market||'unknown'}:${norm(model)}`;let cur=modelMap.get(key);if(!cur){cur={sourceKey:key,make:make||null,model,canonical:row.canonical||null,aliases:[],markets:[],countries:[],regions:[],bodyTypes:[],sources:[],origins:[],yearFrom:null,yearTo:null,imageUrls:[],localNames:[]};}
 cur.aliases=uniq([...cur.aliases,...(row.aliases||[])]);cur.markets=uniq([...cur.markets,...(row.markets||[]),market]);cur.countries=uniq([...cur.countries,...(row.countries||[])]);cur.regions=uniq([...cur.regions,...(row.regions||[])]);cur.bodyTypes=uniq([...cur.bodyTypes,...(row.bodyTypes||[]),row.vehicleClass||null]);cur.sources=uniq([...cur.sources,...(row.sources||[])]);cur.origins=uniq([...cur.origins,origin]);if(row.yearFrom){const y=Number(row.yearFrom);if(Number.isFinite(y))cur.yearFrom=cur.yearFrom?Math.min(cur.yearFrom,y):y;}if(row.yearTo){const y=Number(row.yearTo);if(Number.isFinite(y))cur.yearTo=cur.yearTo?Math.max(cur.yearTo,y):y;}for(const u of [row.imageUrl,...(row.imageUrls||[])])if(clean(u)&&!cur.imageUrls.includes(clean(u)))cur.imageUrls.push(clean(u));if(row.vehicleNameCn&&!cur.localNames.some(x=>x.value===row.vehicleNameCn))cur.localNames.push({value:clean(row.vehicleNameCn),language:'zh',source:'miit'});if(!cur.canonical&&row.canonical)cur.canonical=row.canonical;modelMap.set(key,cur);}
for(const row of global)mergeModel(row,'global');for(const row of western)mergeModel(row,'western');for(const row of asia)mergeModel(row,'asia');
const models=[...modelMap.values()].sort((a,b)=>`${a.make||''} ${a.model}`.localeCompare(`${b.make||''} ${b.model}`,'en'));
const brandMap=new Map();for(const row of models){if(!row.make)continue;const k=norm(row.make);const cur=brandMap.get(k)||{sourceKey:k,canonicalName:row.canonical?.canonicalMake||row.make,observedNames:[],markets:[],sources:[],modelCount:0};cur.observedNames=uniq([...cur.observedNames,row.make]);cur.markets=uniq([...cur.markets,...row.markets]);cur.sources=uniq([...cur.sources,...row.sources]);cur.modelCount++;brandMap.set(k,cur);}const brands=[...brandMap.values()].sort((a,b)=>a.canonicalName.localeCompare(b.canonicalName,'en'));
const marketCounts={};for(const row of models){const ms=row.markets.length?row.markets:['global'];for(const m of ms)marketCounts[m]=(marketCounts[m]||0)+1;}
const brandFiles=await writeChunks('brands','source_master_brand',brands);const modelFiles=await writeChunks('models','source_master_model',models);
const evidenceRefs={global:await list('variant-evidence-'),western:await list('western-variant-evidence-'),asia:await list('asia-variant-evidence-')};
const reports={global:'../denominator/coverage-report.json',western:'../denominator/western-coverage-report.json',asia:'../denominator/asia-coverage-report.json'};
const manifest={schemaVersion:1,id:'avtocena-vehicle-knowledge-source-master',builtAt:new Date().toISOString(),status:'source_master_built',contract:{japan:{fromYear:2010},china:{fromYear:2020},korea:{fromYear:2020},europe:{fromYear:2020},us:{fromYear:2020},canada:{fromYear:2020},uae:{fromYear:2020,coverage:'global manufacturers plus runtime gaps'},georgia:{fromYear:2020,coverage:'global manufacturers plus runtime gaps'},kyrgyzstan:{fromYear:2020,coverage:'global manufacturers plus runtime gaps'}},counts:{brands:brands.length,models:models.length,modelsWithKnownMake:models.filter(x=>x.make).length,modelsWithCanonicalV2:models.filter(x=>x.canonical?.modelId).length,modelsWithImageUrl:models.filter(x=>x.imageUrls.length).length,byMarket:marketCounts,evidenceChunks:Object.values(evidenceRefs).reduce((n,a)=>n+a.length,0)},files:{brands:brandFiles,models:modelFiles,evidenceRefs,reports},truthRule:'This master is the single source-backed denominator. Source identities are not promoted to verified runtime facts until canonicalization/conflict checks pass.',contentDigest:hash(JSON.stringify(models.map(x=>[x.sourceKey,x.sources,x.yearFrom,x.yearTo])))};
await fs.writeFile(path.join(OUT,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2));if(models.length<5000)throw new Error(`knowledge_source_master_too_small:${models.length}`);
