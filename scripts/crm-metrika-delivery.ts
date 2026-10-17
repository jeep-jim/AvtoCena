import {flushMetrika} from '../apps/web/lib/metrika-crm';
flushMetrika().then(result=>{console.log(JSON.stringify(result));if('error' in result)process.exitCode=1;}).catch(()=>{console.error('metrika_worker_failed');process.exitCode=1;});
