import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT=path.resolve(process.env.KNOWLEDGE_OUTPUT_ROOT||"data/catalog/knowledge-source-snapshots/generated");
const OUT=path.join(ROOT,"miit");
const ENDPOINT="https://service.miit-eidc.org.cn/miitxxgk/gonggao/xxgk/doCpQuery";
const FIRST=Math.max(328,Number(process.env.KNOWLEDGE_MIIT_FIRST_BATCH||328));
const LAST=Math.max(FIRST,Math.min(408,Number(process.env.KNOWLEDGE_MIIT_LAST_BATCH||408)));
const PAGE_SIZE=Math.max(10,Math.min(2000,Number(process.env.KNOWLEDGE_MIIT_PAGE_SIZE||1000)));
const MAX_PAGES=Math.max(1,Math.min(10,Number(process.env.KNOWLEDGE_MIIT_MAX_PAGES_PER_BATCH||2)));
const QUERY_TERM=String(process.env.KNOWLEDGE_MIIT_ENTERPRISE_QUERY||"汽车").trim();
if([...QUERY_TERM].length<2)throw new Error("miit_enterprise_query_too_short");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const sha256=(v)=>crypto.createHash("sha256").update(v).digest("hex");

async function queryOnce(batch,pageNum){
 const body=new URLSearchParams({qymc:QUERY_TERM,pc:String(batch),cpsb:"",clxh:"",clmc:"",pageSize:String(PAGE_SIZE),pageNum:String(pageNum)});
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
 try{
  const r=await fetch(ENDPOINT,{method:"POST",body,signal:controller.signal,redirect:"follow",headers:{accept:"application/json,text/plain,*/*","content-type":"application/x-www-form-urlencoded; charset=UTF-8","x-requested-with":"XMLHttpRequest",referer:`https://service.miit-eidc.org.cn/miitxxgk/gonggao/xxgk/queryByPc?pc=${batch}&querylb=cp&qyinfolb=`,"user-agent":"AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com; public MIIT data client)"}});
  const text=await r.text();if(!r.ok)throw new Error(`http_${r.status}:${text.slice(0,120)}`);
  if(/访问行为验证|滑块|captcha|verify/i.test(text))return {blocked:true,text};
  try{return {blocked:false,payload:JSON.parse(text),text};}catch{throw new Error(`non_json:${text.slice(0,300)}`);}
 }finally{clearTimeout(timer);}
}
async function query(batch,pageNum){
 let lastError;
 for(let attempt=1;attempt<=3;attempt++){
  try{return await queryOnce(batch,pageNum);}catch(error){lastError=error;if(attempt<3)await sleep(400*attempt);}
 }
 throw lastError;
}
await fs.mkdir(path.join(OUT,"products"),{recursive:true});
const summary={schemaVersion:1,id:"miit-road-vehicle-products-public-query",authority:"government_type_approval",fetchedAt:new Date().toISOString(),status:"complete_bounded_batch_sample",endpoint:ENDPOINT,query:{enterpriseContains:QUERY_TERM,pagesPerBatch:MAX_PAGES,scope:"bounded public-query evidence; not an exhaustive copy of every MIIT product row"},batches:{},counts:{batchesRequested:LAST-FIRST+1,batchesComplete:0,products:0,totalMatchesReported:0,blockedBatches:0,failedBatches:0},errors:[]};
for(let batch=FIRST;batch<=LAST;batch++){
 const products=[];let page=1,totalPages=1,totalExpected=null,status="sampled";
 try{
  while(page<=totalPages&&page<=MAX_PAGES){
   const result=await query(batch,page);
   if(result.blocked){status="blocked";summary.counts.blockedBatches++;break;}
   const data=result.payload||{};if(Number(data?.handleResult?.respCode)!==200){throw new Error(`miit_resp_${data?.handleResult?.respCode}:${data?.handleResult?.digest||"unknown"}`);}
   const rows=Array.isArray(data.cpList)?data.cpList:[];for(const row of rows)products.push({qymc:row.qymc??null,cpsb:row.cpsb??null,clxh:row.clxh??null,clmc:row.clmc??null,gppc:Number(row.gppc||batch)||batch,dataTag:row.dataTag??null,cpid:row.cpid??null});
   totalPages=Math.max(1,Number(data?.countResult?.totalPage||1));totalExpected=Number(data?.countResult?.total||products.length);
   if(page===1&&Number(data?.countResult?.pageSize||0)&&Number(data.countResult.pageSize)<PAGE_SIZE){summary.errors.push({batch,warning:`server_page_size_${data.countResult.pageSize}_requested_${PAGE_SIZE}`});}
   page++;if(page<=totalPages)await sleep(120);
  }
  if(status==="sampled")summary.counts.batchesComplete++;
 }catch(error){status="failed";summary.status="partial";summary.counts.failedBatches++;summary.errors.push({batch,error:String(error?.message||error)});}
 const payload={schemaVersion:1,sourceId:"miit-road-vehicle-products",batch,status,totalExpected,products};
 const text=JSON.stringify(payload,null,2)+"\n";await fs.writeFile(path.join(OUT,"products",`batch-${batch}.json`),text);summary.batches[String(batch)]={status,products:products.length,totalExpected,pagesSampled:Math.min(MAX_PAGES,totalPages),sha256:sha256(text)};summary.counts.products+=products.length;summary.counts.totalMatchesReported+=Number(totalExpected||0);
 if(status==="blocked"){summary.status="partial";break;}
 await sleep(120);
}
await fs.writeFile(path.join(OUT,"products-manifest.json"),JSON.stringify(summary,null,2)+"\n");console.log(JSON.stringify(summary,null,2));
const minimumSample=Math.min(1000,summary.counts.batchesRequested*10);
if(summary.counts.products<minimumSample&&summary.counts.blockedBatches===0)throw new Error(`miit_products_sample_too_small:${summary.counts.products}:${minimumSample}`);
