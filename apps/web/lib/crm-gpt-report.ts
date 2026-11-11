import {createHash} from 'node:crypto';
import {GPT_PROFILE} from './crm-gpt-profile';
import type {TeamIdea} from './team-ideas';
export function gptReleaseReport(rows:TeamIdea[],report:{number:number;text:string},release:string,at:string):TeamIdea[]{
 if(!/^[a-f0-9]{40}$/.test(release)||!Number.isSafeInteger(report.number)||report.number<1||typeof report.text!=='string'||!report.text.trim()||report.text.length>4000)throw Error('invalid_report');
 if(!rows.some(row=>row.number===report.number&&!row.deletedAt))throw Error('idea_missing');
 const id='gpt_'+createHash('sha256').update(`${release}:${report.number}`).digest('hex');
 return rows.map(row=>row.number!==report.number||row.deletedAt||row.comments?.some(c=>c.id===id)?row:{...row,comments:[...(row.comments||[]),{id,authorId:GPT_PROFILE.id,authorName:GPT_PROFILE.displayName,authorAvatarUrl:GPT_PROFILE.avatarUrl,text:report.text.trim(),createdAt:at,screenshots:[]}]});
}
