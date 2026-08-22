import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT=path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT||"data/catalog/knowledge-source-snapshots/generated");
const OUT=path.join(ROOT,"korea");
const URL="https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002922208&fileDetailSn=1&insertDataPrcus=N";
const MAX_BYTES=Math.max(10_000_000,Math.min(150_000_000,Number(process.env.KNOWLEDGE_KOREA_MAX_BYTES||100_000_000)));
const CURRENT_YEAR=new Date().getFullYear();
const sha256=(b)=>crypto.createHash("sha256").update(b).digest("hex");
const clean=(v)=>String(v??"").normalize("NFKC").replace(/\s+/g," ").trim();

function parseCsv(text){
 const rows=[];let row=[];let field="";let quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;continue;}if(ch==='"')quoted=true;else if(ch===','){row.push(field);field="";}else if(ch==='\n'){row.push(field.replace(/\r$/, ""));if(row.some(x=>x!==""))rows.push(row);row=[];field="";}else field+=ch;}
 if(field||row.length){row.push(field.replace(/\r$/, ""));rows.push(row);}return rows;
}
function decode(buf){
 for(const enc of ["utf-8","euc-kr"]){try{const text=new TextDecoder(enc,{fatal:true}).decode(buf);if(/차명|배기량|연료/.test(text.slice(0,3000)))return {text,encoding:enc};}catch{}}
 return {text:new TextDecoder("utf-8").decode(buf),encoding:"utf-8-replacement"};
}
function headerKey(v){return clean(v).replace(/[\s_()（）]/g,"").toLowerCase();}
function findIndex(headers,names){const keys=headers.map(headerKey);for(const name of names){const idx=keys.indexOf(headerKey(name));if(idx>=0)return idx;}return -1;}

await fs.mkdir(OUT,{recursive:true});
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
let response;try{response=await fetch(URL,{signal:controller.signal,redirect:"follow",headers:{accept:"text/csv,application/octet-stream,*/*","user-agent":"AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; public dataset snapshot)"}});}finally{clearTimeout(timer);}
if(!response.ok)throw new Error(`korea_jeju_http_${response.status}`);
const raw=Buffer.from(await response.arrayBuffer());
if(raw.length>MAX_BYTES)throw new Error(`korea_jeju_too_large:${raw.length}`);
const {text,encoding}=decode(raw);const parsed=parseCsv(text);const headers=(parsed.shift()||[]).map(clean);
const ix={
 name:findIndex(headers,["차명","차량명"]),year:findIndex(headers,["모델연도","모델년도"]),cc:findIndex(headers,["배기량"]),fuel:findIndex(headers,["연료"]),purpose:findIndex(headers,["용도구분"]),firstDate:findIndex(headers,["최초등록일"]),class:findIndex(headers,["차종분류"]),type:findIndex(headers,["차종유형"]),kind:findIndex(headers,["차종종별"]),status:findIndex(headers,["등록현황"]),date:findIndex(headers,["데이터기준일자"])
};
if(ix.name<0)throw new Error(`korea_jeju_vehicle_name_column_missing:${JSON.stringify(headers)}`);
if(ix.year<0)throw new Error(`korea_jeju_model_year_column_missing:${JSON.stringify(headers)}`);
const map=new Map();let accepted=0,yearRejected=0;
for(const row of parsed){const name=clean(row[ix.name]);if(!name)continue;const year=Number(String(row[ix.year]||"").replace(/[^0-9]/g,""));if(!Number.isInteger(year)||year<2020||year>CURRENT_YEAR+1){yearRejected++;continue;}const tuple={vehicleName:name,modelYear:year,engineCc:ix.cc>=0?Number(String(row[ix.cc]||"").replace(/[^0-9.]/g,""))||null:null,fuel:ix.fuel>=0?clean(row[ix.fuel])||null:null,vehicleClass:ix.class>=0?clean(row[ix.class])||null:null,vehicleType:ix.type>=0?clean(row[ix.type])||null:null,vehicleKind:ix.kind>=0?clean(row[ix.kind])||null:null,purpose:ix.purpose>=0?clean(row[ix.purpose])||null:null};const key=JSON.stringify(tuple);const cur=map.get(key)||{...tuple,observations:0};cur.observations++;map.set(key,cur);accepted++;}
const tuples=[...map.values()].sort((a,b)=>`${a.vehicleName} ${a.modelYear} ${a.engineCc||0}`.localeCompare(`${b.vehicleName} ${b.modelYear} ${b.engineCc||0}`,"ko"));
const chunkSize=5000;const files=[];for(let i=0;i<tuples.length;i+=chunkSize){const n=Math.floor(i/chunkSize)+1;const name=`jeju-vehicle-registry-tuples-${String(n).padStart(4,"0")}.json`;await fs.writeFile(path.join(OUT,name),JSON.stringify({schemaVersion:1,sourceId:"korea-jeju-registration-file",chunk:n,records:tuples.slice(i,i+chunkSize)},null,2)+"\n");files.push(name);}
const manifest={schemaVersion:1,id:"korea-jeju-registration-file",authority:"government_registration",fetchedAt:new Date().toISOString(),status:"complete_compacted_2020_plus",sourceUrl:URL,raw:{bytes:raw.length,sha256:sha256(raw),encoding,rows:parsed.length,storedInGit:false,note:"Raw registration rows are not committed because duplicate registrations add repository weight without adding vehicle knowledge; only explicit model-year 2020+ technical/name tuples plus observation counts are committed."},headers,columnIndexes:ix,counts:{rowsParsed:parsed.length,rowsIn2020Plus:accepted,rowsRejectedMissingOrOutsideYearWindow:yearRejected,uniqueTuples:tuples.length},files};
await fs.writeFile(path.join(OUT,"jeju-registry-manifest.json"),JSON.stringify(manifest,null,2)+"\n");console.log(JSON.stringify(manifest,null,2));
if(parsed.length<100000)throw new Error(`korea_jeju_row_collapse:${parsed.length}`);
if(accepted<1000||tuples.length<500)throw new Error(`korea_jeju_2020plus_collapse:${accepted}:${tuples.length}`);
