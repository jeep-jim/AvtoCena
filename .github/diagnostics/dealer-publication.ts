import {readFile} from 'node:fs/promises';
import {readDataJson} from '../../apps/web/lib/data';
import {dealerAccessLevel,EMPTY_MEMBERSHIP,type Membership} from '../../apps/web/lib/dealers/program-model';
const marker=JSON.parse(await readFile('.github/market-runs/dealer-publication.json','utf8'));
if(!/^\/[a-z][a-z0-9-]{1,39}\/[a-z][a-z0-9-]{1,39}$/.test(marker.path))throw Error('Invalid requested profile path');
const links=await readDataJson<Record<string,string>>('dealers/profile-links.json',{});
const id=links[marker.path];
if(!id||!/^[-a-zA-Z0-9_]{1,80}$/.test(id)){console.log(JSON.stringify({path:marker.path,found:false}));process.exit(0);}
const companies=await readDataJson<Array<{id:string;status:string}>>('dealers/dealers.json',[]);
const company=companies.find(d=>d.id===id);
const showcase=await readDataJson<{profileEnabled?:boolean}>(`dealers/showcases/${id}.json`,{});
const membership=await readDataJson<Membership>(`dealers/memberships/${id}.json`,EMPTY_MEMBERSHIP);
const access=dealerAccessLevel(id,membership);
console.log(JSON.stringify({path:marker.path,found:!!company,companyStatus:company?.status,profileEnabled:showcase.profileEnabled===true,agreementSubmitted:!!membership.agreement,agreementApproved:!!membership.agreement?.approvedAt,accessLevel:access.level,fullAccess:access.full,publicEligible:showcase.profileEnabled===true&&company?.status==='verified'&&access.full}));
