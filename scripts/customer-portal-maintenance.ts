import {cleanCustomerMessageRevisions} from '../apps/web/lib/account/maintenance';
cleanCustomerMessageRevisions(process.argv.includes('--apply')).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('customer_message_cleanup_failed');process.exitCode=1;});
