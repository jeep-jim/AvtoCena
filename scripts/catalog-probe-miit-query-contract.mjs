import fs from "node:fs/promises";
import path from "node:path";

const outDir=path.resolve("data/catalog/knowledge-source-snapshots/generated/miit/contract");
await fs.mkdir(outDir,{recursive:true});
const urls=[
  "https://service.miit-eidc.org.cn/miitxxgk/gonggao_xxgk/js/gg_xxgk_cp_pc.js",
  "https://service.miit-eidc.org.cn/miitxxgk/gonggao_xxgk/js/gg_xxgk_cp.js"
];
const results=[];
for(const url of urls){
  try{
    const r=await fetch(url,{headers:{"user-agent":"AvtoCena-KnowledgeCORE/1.0 (+https://avtocena.com)",accept:"application/javascript,text/javascript,*/*"},redirect:"follow"});
    if(!r.ok)throw new Error(`http_${r.status}`);
    const text=await r.text();
    const name=new URL(url).pathname.split("/").pop();
    await fs.writeFile(path.join(outDir,name),text);
    const strings=[...text.matchAll(/["'`]([^"'`\n]{3,300})["'`]/g)].map(m=>m[1]);
    const endpoints=[...new Set(strings.filter(s=>/query|ajax|gonggao|xxgk|data|page/i.test(s)))];
    const ajaxBlocks=[...text.matchAll(/\$\.ajax\s*\(\s*\{([\s\S]{0,3000}?)\}\s*\)/g)].map(m=>m[1]);
    results.push({url,status:"ok",bytes:Buffer.byteLength(text),endpoints,ajaxBlocks});
  }catch(error){results.push({url,status:"failed",error:String(error?.message||error)});}
}
await fs.writeFile(path.join(outDir,"contract.json"),JSON.stringify({fetchedAt:new Date().toISOString(),results},null,2)+"\n");
console.log(JSON.stringify(results,null,2));
