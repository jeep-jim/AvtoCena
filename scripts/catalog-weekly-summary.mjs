import fs from 'node:fs/promises';
const rows=[];
for(const market of ['korea','china','uae','europe','georgia','japan']) {
 let report;try{report=JSON.parse(await fs.readFile(`catalog-weekly-${market}-publish-report.json`,'utf8'));}catch{}
 const count=Number(report?.byMarket?.[market] || 0);
 rows.push({market,published:report?.published===true,count,target:10000,shortfall:Math.max(0,10000-count),
  generationId:report?.generationId || null,error:report?.publicationError || (!report?'publication_report_missing':null)});
}
await fs.writeFile('catalog-weekly-summary.json',JSON.stringify({generatedAt:new Date().toISOString(),markets:rows},null,2));
console.log(JSON.stringify(rows,null,2));
if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
 '| Market | Published | Count | Target | Shortfall |\n|---|---|---:|---:|---:|\n'+rows.map(r=>`| ${r.market} | ${r.published} | ${r.count} | ${r.target} | ${r.shortfall} |`).join('\n'));
if(rows.some(r=>!r.published || r.shortfall || r.error))process.exitCode=1;
