import {purgeExpiredDocuments} from '../apps/web/lib/client-document-trash';
async function main(){
 const result=await purgeExpiredDocuments();
 console.log(JSON.stringify(result));
 if(result.failed.length)process.exitCode=1;
}
main().catch(error=>{console.error('Document retention failed:',error instanceof Error?error.message:'unknown');process.exitCode=1;});
