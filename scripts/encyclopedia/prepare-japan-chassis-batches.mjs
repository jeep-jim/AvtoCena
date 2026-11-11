import fs from 'node:fs/promises';
import {digest,validateBatch} from './research-batch.mjs';
const dir='docs/encyclopedia/japan-chassis-drive-2026-10-25';
const names=(await fs.readdir(dir)).filter(n=>/^part-\d{4}\.json$/.test(n)).sort();
const parts=[],rows=[];
for(const path of names){const chunk=JSON.parse(await fs.readFile(`${dir}/${path}`,'utf8'));parts.push({path,rows:chunk.length,sha256:digest(chunk)});rows.push(...chunk);}
const manifest={version:1,checkedAt:'2026-10-25',groups:rows.length,confirmed:rows.filter(r=>r.status==='confirmed').length,ambiguous:rows.filter(r=>r.status==='ambiguous').length,unresolved:rows.filter(r=>r.status==='unresolved').length,glossary:'https://www.mlit.go.jp/jidosha/content/001986917.pdf',parts};
await fs.writeFile(`${dir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
// Refresh source checkpoints without rewriting already applied immutable batches.
if(process.argv.includes('--reference-only')){console.log(JSON.stringify({...manifest,parts:parts.length}));process.exit(0);}
const norm=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const code=s=>String(s).toUpperCase().replace(/^[A-Z0-9]{1,3}-/,'');
const targets=JSON.parse(await fs.readFile('reports/japan-chassis/targets-0000.json','utf8'));
const entries=[];
for(const t of targets){
 if(t.drive||t.status==='verified')continue;
 const r=rows.find(r=>norm(r.make)===norm(t.make)&&r.chassisCode===code(t.chassisCode));
 if(r?.drives.length!==1)continue;
 const e=r.evidence.find(e=>e.drive===r.drives[0]);
 entries.push({modelId:t.modelId,variantId:t.variantId,expectedDigest:t.expectedDigest,make:t.make,model:t.model,year:t.year,...(t.trim!==undefined?{trim:t.trim}:{}),patch:{drive:r.drives[0]},confirmedFields:['drive'],source:{type:e.sourceType||'official_registry',url:e.url,checkedAt:'2026-10-25',statement:e.statement||`MLIT: код ${e.fullCode}, лист ${e.sheet}, строка ${e.row}; привод ${r.drives[0]}. Для этого кода марки в проверенных таблицах нет противоречащего привода. Словарь F/R/A: https://www.mlit.go.jp/jidosha/content/001986917.pdf`}});
}
const batches=[];
for(let i=0;i<entries.length;i+=64){
 const suffix=String(i/64).padStart(4,'0'),id=`research-japan-chassis-drive-2026-10-25-${suffix}`;
 const batch=validateBatch({version:1,id,entries:entries.slice(i,i+64)}),path=`docs/encyclopedia/batches/2026-10-25-japan-chassis-drive-${suffix}.json`;
 await fs.writeFile(path,JSON.stringify(batch,null,2)+'\n');
 await fs.writeFile(`${dir}/apply-${suffix}.json`,JSON.stringify({batch:path,sha256:digest(batch)},null,2)+'\n');batches.push(path);
}
console.log(JSON.stringify({...manifest,parts:parts.length,patches:entries.length,batches}));
