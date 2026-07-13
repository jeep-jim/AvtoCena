import fs from 'node:fs';
const input=process.argv[2]; if(!input){ console.log('Usage: node scripts/catalog-import.mjs file.json|file.csv'); process.exit(0); }
const raw=fs.readFileSync(input,'utf8'); let rows=[];
if(input.endsWith('.json')) rows=JSON.parse(raw); else { const [h,...lines]=raw.trim().split(/\r?\n/); const keys=h.split(','); rows=lines.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[keys[i],v]))); }
fs.mkdirSync('data/catalog/manual-imports',{recursive:true}); fs.writeFileSync(`data/catalog/manual-imports/import-${Date.now()}.json`, JSON.stringify(rows,null,2)); console.log(`Imported ${rows.length} rows`);
