import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync=promisify(execFile);
const ROOT=path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT||"data/catalog/knowledge-source-snapshots/generated");
const MLIT=path.join(ROOT,"mlit");
const refs=JSON.parse(await fs.readFile(path.join(MLIT,"discovered-attachments.json"),"utf8"));
const OUT=path.join(MLIT,"pdf-text");await fs.rm(OUT,{recursive:true,force:true});await fs.mkdir(OUT,{recursive:true});
const sha256=(b)=>crypto.createHash("sha256").update(b).digest("hex");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const MAX=Math.max(20,Math.min(500,Number(process.env.KNOWLEDGE_MLIT_PDF_MAX||350)));
const KEEP=/普通.{0,4}小型自動車|軽自動車|輸入自動車|プラグインハイブリッド|電気自動車|乗用車|燃費一覧|JC08|WLTC/i;
const DROP=/組織|用語|燃費向上技術|平均値の推移|CO2排出量$/i;
const selected=[...new Map(refs.filter(x=>x.kind==="pdf_reference"&&KEEP.test(String(x.text||""))&&!DROP.test(String(x.text||""))).map(x=>[x.url,x])).values()].slice(0,MAX);
const manifest={schemaVersion:1,id:"mlit-japan-passenger-pdf-text",authority:"government_type_approval_efficiency",fetchedAt:new Date().toISOString(),status:"complete",selected:selected.length,converted:0,skippedOld:0,failed:0,files:[],errors:[]};
function yearsFrom(value){
 const text=String(value||"").normalize("NFKC");const years=[];
 for(const m of text.matchAll(/\b(20(?:0\d|1\d|2[0-9]))\b/g))years.push(Number(m[1]));
 for(const m of text.matchAll(/(?:令和|R)\s*([0-9]{1,2})/gi)){const n=Number(m[1]);if(n>0)years.push(2018+n);}
 for(const m of text.matchAll(/(?:平成|H)\s*([0-9]{1,2})/gi)){const n=Number(m[1]);if(n>0)years.push(1988+n);}
 return [...new Set(years.filter(y=>y>=1900&&y<=2035))].sort((a,b)=>a-b);
}
for(let i=0;i<selected.length;i++){
 const ref=selected[i];const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);let tmpPdf=null,tmpTxt=null;
 try{
  const r=await fetch(ref.url,{signal:controller.signal,redirect:"follow",headers:{accept:"application/pdf,*/*","user-agent":"AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; MLIT public-data snapshot)"}});if(!r.ok)throw new Error(`http_${r.status}`);const pdf=Buffer.from(await r.arrayBuffer());if(pdf.length>25_000_000)throw new Error(`pdf_too_large:${pdf.length}`);const digest=sha256(pdf);tmpPdf=path.join(os.tmpdir(),`mlit-${digest}.pdf`);tmpTxt=path.join(os.tmpdir(),`mlit-${digest}.txt`);await fs.writeFile(tmpPdf,pdf);await execFileAsync("pdftotext",["-layout","-enc","UTF-8",tmpPdf,tmpTxt],{timeout:60000,maxBuffer:5_000_000});const text=await fs.readFile(tmpTxt,"utf8");
  const years=[...new Set([...yearsFrom(ref.sourcePageTitle),...yearsFrom(ref.text),...yearsFrom(text.slice(0,12000))])].sort((a,b)=>a-b);const maxYear=years.length?Math.max(...years):null;if(maxYear&&maxYear<2010){manifest.skippedOld++;continue;}
  const name=`${String(i+1).padStart(4,"0")}-${digest.slice(0,16)}.txt`;await fs.writeFile(path.join(OUT,name),text);manifest.files.push({file:`mlit/pdf-text/${name}`,sourceUrl:ref.url,title:ref.text||null,sourcePageUrl:ref.sourcePageUrl||null,sourcePageTitle:ref.sourcePageTitle||null,pdfBytes:pdf.length,pdfSha256:digest,textBytes:Buffer.byteLength(text),years});manifest.converted++;
 }catch(error){manifest.failed++;manifest.status="partial";manifest.errors.push({url:ref.url,title:ref.text||null,sourcePageUrl:ref.sourcePageUrl||null,error:String(error?.message||error)});}finally{clearTimeout(timer);if(tmpPdf)await fs.rm(tmpPdf,{force:true});if(tmpTxt)await fs.rm(tmpTxt,{force:true});}
 if(i+1<selected.length)await sleep(100);
}
await fs.writeFile(path.join(MLIT,"pdf-text-manifest.json"),JSON.stringify(manifest,null,2)+"\n");console.log(JSON.stringify(manifest,null,2));if(manifest.converted===0)throw new Error("mlit_pdf_text_zero");