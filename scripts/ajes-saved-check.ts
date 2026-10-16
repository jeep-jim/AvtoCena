import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const v:any=await getJsonStorage().readJson('catalog/partner-cache/ajes/stats/0eJPgNSrAoJnEh.json',null);
 const l=v?.items?.[0];
 console.log('AJES_SAVED_FIELDS',JSON.stringify(l?Object.fromEntries(['engineCc','sourceFuel','sourcePower','sourceDrive','sourceTransmission','chassisCode'].map(k=>[k,l[k]])):{found:false}));
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
