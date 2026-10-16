import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 let index=0;
 for(const id of ['0eJPgNSrAoJnEh','299FXaEvz7o6g24']){
 const v:any=await getJsonStorage().readJson('catalog/partner-cache/ajes/stats/'+id+'.json',null);
 const l=v?.items?.[0], info=typeof l?.info==='string'?l.info:'';
 console.log('AJES_FULL_FIELDS',JSON.stringify({index:index++,found:!!l,...(l?Object.fromEntries(['engineCc','sourceFuel','sourcePower','sourceDrive','sourceTransmission'].map(k=>[k,l[k]])):{}),infoLength:info.length,infoFuelLabels:/fuel|топливо|燃料/i.test(info),infoPowerLabels:/horsepower|мощност|馬力|[0-9]\s*(?:hp|kw|ps|л\.с)/i.test(info),infoHtml:/<[^>]+>/.test(info)}));
 }
}
main().catch(()=>{console.log('AJES_SAVED_READ_FAILED');process.exitCode=1;});
