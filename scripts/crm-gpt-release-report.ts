/** Invoked only after the exact release passes production deployment checks. */
import fs from 'node:fs/promises';
import {gptReleaseReport} from '../apps/web/lib/crm-gpt-report';
import {getJsonStorage,mutateDataJson} from '../apps/web/lib/data';
import {GPT_PROFILE} from '../apps/web/lib/crm-gpt-profile';
import type {TeamIdea} from '../apps/web/lib/team-ideas';
async function main(){
const release=process.env.GITHUB_SHA||'';
if(!/^[a-f0-9]{40}$/.test(release))throw Error('release_required');
const marker=JSON.parse(await fs.readFile('.github/market-runs/regcloud-deploy.json','utf8'));
const reports=marker.ideaReports||[];
if(!Array.isArray(reports)||reports.length>10)throw Error('invalid_reports');
for(const report of reports){if(!Number.isSafeInteger(report.number)||report.number<1||typeof report.text!=='string'||!report.text.trim()||report.text.length>4000)throw Error('invalid_report');}
if(reports.length){
 await getJsonStorage().writeJson('crm/service-profiles/gpt.json',GPT_PROFILE);
 for(const report of reports){
  await mutateDataJson<TeamIdea[]>('crm/team-ideas/items.json',[],rows=>gptReleaseReport(rows,report,release,new Date().toISOString()));
  console.log(JSON.stringify({idea:report.number,report:'published',release}));
 }
}

}
main().catch(error=>{console.error(error instanceof Error?error.message:"report_failed");process.exitCode=1;});
