import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SNAPSHOT_ROOT = path.resolve(process.env.KNOWLEDGE_SNAPSHOT_ROOT || "data/catalog/knowledge-source-snapshots/generated");
const OUT_ROOT = path.resolve(process.env.KNOWLEDGE_DENOMINATOR_ROOT || "data/catalog/knowledge-source-snapshots/denominator");
const CHUNK_SIZE = Math.max(50, Math.min(250, Number(process.env.KNOWLEDGE_DENOMINATOR_CHUNK_SIZE || 250)));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const clean = (value) => String(value ?? "").replace(/^\uFEFF/, "").normalize("NFKC").replace(/\s+/g, " ").trim();
const normKey = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
const num = (value) => { const n = Number(String(value ?? "").replace(/,/g, ".")); return Number.isFinite(n) ? n : null; };

function parseCsv(text) {
  const rows=[]; let row=[]; let field=""; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){ if(ch==='"'&&text[i+1]==='"'){field+='"';i++;} else if(ch==='"')quoted=false; else field+=ch; continue; }
    if(ch==='"') quoted=true; else if(ch===','){row.push(field);field="";} else if(ch==='\n'){row.push(field.replace(/\r$/, "")); if(row.some(v=>v!==""))rows.push(row); row=[]; field="";} else field+=ch;
  }
  if(field||row.length){row.push(field.replace(/\r$/, ""));rows.push(row);}
  const rawHeaders=(rows.shift()||[]).map(clean);
  const headers=rawHeaders.map(h=>normKey(h));
  return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??""])));
}
async function readCsv(file){try{return parseCsv(await fs.readFile(file,"utf8"));}catch{return[];}}
async function readJson(file,fallback=null){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch{return fallback;}}
async function ensureDir(dir){await fs.mkdir(dir,{recursive:true});}
async function writeChunked(prefix,entityType,records){
  const files=[];
  for(let i=0;i<records.length;i+=CHUNK_SIZE){const chunk=Math.floor(i/CHUNK_SIZE)+1;const name=`${prefix}-${String(chunk).padStart(4,"0")}.json`;await fs.writeFile(path.join(OUT_ROOT,name),`${JSON.stringify({schemaVersion:1,entityType,chunk,maxRecords:CHUNK_SIZE,records:records.slice(i,i+CHUNK_SIZE)},null,2)}\n`);files.push(name);}return files;
}
function first(row,...keys){for(const key of keys){const v=clean(row[normKey(key)]);if(v)return v;}return "";}
function yearValue(row){const v=Number(first(row,"year","model year","modelyear"));return Number.isInteger(v)?v:null;}

await ensureDir(OUT_ROOT);
const modelMap=new Map();
const evidence=[];
function addModel(make,model,market,source,year){
  make=clean(make);model=clean(model);if(!make||!model)return;
  const key=`${normKey(make)}:${normKey(model)}`;const current=modelMap.get(key)||{key,make,model,markets:[],sources:[],yearFrom:null,yearTo:null};
  if(!current.markets.includes(market))current.markets.push(market);if(!current.sources.includes(source))current.sources.push(source);
  if(year){current.yearFrom=current.yearFrom?Math.min(current.yearFrom,year):year;current.yearTo=current.yearTo?Math.max(current.yearTo,year):year;}
  modelMap.set(key,current);
}

const usRows=await readCsv(path.join(SNAPSHOT_ROOT,"us","fueleconomy-vehicles.csv"));
let usIncluded=0;
for(const row of usRows){const year=yearValue(row);if(!year||year<2020)continue;const make=first(row,"make");const model=first(row,"baseModel","base model")||first(row,"model");if(!make||!model)continue;addModel(make,model,"us","us-epa-fueleconomy",year);evidence.push({evidenceId:`us-epa:${sha256(JSON.stringify(row)).slice(0,20)}`,sourceId:"us-epa-fueleconomy",market:"us",year,make,model,fullModel:first(row,"model")||model,vehicleClass:first(row,"VClass","vehicle class")||null,drive:first(row,"drive")||null,transmission:first(row,"trany","transmission")||null,fuel:first(row,"fuelType","fuelType1","fuel type")||null,powertrainKind:first(row,"atvType")||null,engineLiters:num(first(row,"displ")),cylinders:num(first(row,"cylinders")),electricMotor:first(row,"evMotor")||null,rangeMiles:num(first(row,"range"))});usIncluded++;}

const canadaDir=path.join(SNAPSHOT_ROOT,"canada");
let canadaFiles=[];try{canadaFiles=(await fs.readdir(canadaDir)).filter(f=>f.endsWith(".csv"));}catch{}
let canadaIncluded=0;
for(const file of canadaFiles){for(const row of await readCsv(path.join(canadaDir,file))){const year=yearValue(row);if(!year||year<2020)continue;const make=first(row,"make");const model=first(row,"model");if(!make||!model)continue;addModel(make,model,"canada","canada-nrcan",year);evidence.push({evidenceId:`ca-nrcan:${sha256(`${file}:${JSON.stringify(row)}`).slice(0,20)}`,sourceId:"canada-nrcan",market:"canada",year,make,model,vehicleClass:first(row,"vehicle class")||null,engineLiters:num(first(row,"engine size (l)","engine size")),cylinders:num(first(row,"cylinders")),transmission:first(row,"transmission")||null,fuel:first(row,"fuel type")||null,cityL100km:num(first(row,"city (l/100 km)")),highwayL100km:num(first(row,"highway (l/100 km)")),combinedL100km:num(first(row,"combined (l/100 km)"))});canadaIncluded++;}}

let nhtsaIncluded=0;
let nhtsaCurrentMakes=0;
const boundedNhtsa=await readJson(path.join(SNAPSHOT_ROOT,"us","nhtsa-models-current-makes.json"),null);
if(boundedNhtsa){
  for(const item of boundedNhtsa.makeResults||[]){
    nhtsaCurrentMakes++;
    for(const row of item.results||[]){const make=clean(row.Make_Name||row.MakeName||item.queriedMake);const model=clean(row.Model_Name||row.ModelName);if(!make||!model)continue;addModel(make,model,"us","us-nhtsa-vpic",null);nhtsaIncluded++;}
  }
} else {
  // Temporary compatibility with the older snapshot shape; new snapshots use
  // bounded make-level calls derived from EPA 2020+ makes.
  const legacy=await readJson(path.join(SNAPSHOT_ROOT,"us","nhtsa-all-models.json"),null);
  for(const row of legacy?.Results||[]){const make=clean(row.Make_Name||row.MakeName);const model=clean(row.Model_Name||row.ModelName);if(!make||!model)continue;addModel(make,model,"us","us-nhtsa-vpic",null);nhtsaIncluded++;}
}

const models=[...modelMap.values()].sort((a,b)=>`${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`,"en"));
evidence.sort((a,b)=>`${a.make} ${a.model} ${a.year}`.localeCompare(`${b.make} ${b.model} ${b.year}`,"en"));
const modelFiles=await writeChunked("western-models","source_model_western",models);
const evidenceFiles=await writeChunked("western-variant-evidence","source_variant_evidence_western",evidence);
const report={schemaVersion:1,builtAt:new Date().toISOString(),status:models.length&&evidence.length?"collected":"partial",counts:{sourceModels:models.length,variantEvidence:evidence.length,usFuelEconomyRowsIncluded:usIncluded,nhtsaCurrentMakes,nhtsaModelsIncluded:nhtsaIncluded,canadaRowsIncluded:canadaIncluded},files:{models:modelFiles,evidence:evidenceFiles},contract:{fromYear:2020,markets:["us","canada"],note:"Source evidence only; canonical CORE promotion requires normalization and conflict checks. NHTSA is bounded to makes observed in EPA 2020+ data."}};
await fs.writeFile(path.join(OUT_ROOT,"western-coverage-report.json"),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify(report,null,2));
if(models.length<500)throw new Error(`western_model_denominator_too_small:${models.length}`);
