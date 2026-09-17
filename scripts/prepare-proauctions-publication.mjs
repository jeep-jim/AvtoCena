import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.env.PROAUCTIONS_OUTPUT || 'proauctions-collection';
const output=process.env.CATALOG_REBUILD_INPUT_DIR || 'proauctions-ready';
const rows=[];
for(const f of (await fs.readdir(path.join(root,'offers'))).filter(f=>f.endsWith('.json')))rows.push(JSON.parse(await fs.readFile(path.join(root,'offers',f),'utf8')));
const owners=new Map();
for(const row of rows)for(const img of row.images){const ids=owners.get(img.checksum)||new Set();ids.add(row.id);owners.set(img.checksum,ids);}
const accepted=rows.filter(r=>r.images.every(i=>owners.get(i.checksum).size===1));
await fs.mkdir(output,{recursive:true});
for(let i=0;i<accepted.length;i+=250)await fs.writeFile(path.join(output,`catalog-rebuild-japan-${String(i/250+1).padStart(4,'0')}.json`),JSON.stringify({market:'japan',offers:accepted.slice(i,i+250)}));
const report={prepared:rows.length,crossLotImagesRejected:rows.length-accepted.length,admitted:accepted.length,published:false};
await fs.writeFile(path.join(root,'admission.json'),JSON.stringify(report,null,2));
if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`count=${accepted.length}\n`);
console.log(JSON.stringify(report));
