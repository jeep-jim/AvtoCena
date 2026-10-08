import {maintainIdeas} from '../apps/web/lib/team-ideas-retention';
maintainIdeas().then(result=>{console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;}).catch(()=>{console.error('Idea retention failed');process.exitCode=1;});
