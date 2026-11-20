import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const active='gen_1795200000000_current',previous='gen_1795197000000_previous',base='gen_1794878284419_inherited';
const ref='catalog/generations/'+base+'/offers/europe/chunk-0001.json';
const rogue='catalog/generations/'+base+'/offers/europe/chunk-0002.json';
const foreign='catalog/generations/'+base+'/offers/korea/chunk-0001.json';
const currentRef='catalog/generations/'+previous+'/offers/europe/chunk-0038.json';
const byId={legacy:{market:'europe',chunk:'chunk-0038'},inherited:{market:'europe',chunk:ref},
 stray:{market:'europe',chunk:rogue},foreign:{market:'europe',chunk:foreign}};
async function put(key,body){
 const f='data/'+key;await fs.mkdir(path.dirname(f),{recursive:true});await fs.writeFile(f,JSON.stringify(body));
}
const row=(id,sourceId='mobile_de_open')=>({id,sourceId,market:'europe',make:'TestMake',model:'TestModel'});
await put('catalog/manifest.json',{version:2,generationId:active,markets:{europe:{count:1,chunks:[ref]}}});
await put('catalog/previous-manifest.json',{version:2,generationId:previous,markets:{europe:{count:2,chunks:[ref,'chunk-0038']}}});
await put('catalog/generations/'+previous+'/indexes/offers-by-id.json',{generationId:previous,byId});
await put(ref,[row('inherited')]);await put(currentRef,[row('legacy')]);await put(rogue,[row('stray')]);await put(foreign,[row('foreign')]);
const {getUnavailableOffer,readMarketOffers}=await import('./apps/web/lib/catalog/storage.ts');
assert.equal((await readMarketOffers('europe'))[0].id,'inherited');
assert.equal((await getUnavailableOffer('legacy')).reason,'unavailable');
assert.equal(await getUnavailableOffer('stray'),null);assert.equal(await getUnavailableOffer('foreign'),null);
const prior=await getUnavailableOffer('inherited');
if(process.argv[2]==='patched'){assert.equal(prior?.id,'inherited');assert.equal(prior?.reason,'unavailable');}
else assert.equal(prior,null);
console.log(JSON.stringify({mode:process.argv[2],existingRelativePreviousReader:'unchanged',activeAbsolute:'passed',inheritedPreviousFixed:!!prior,foreignAndUnlistedRejected:true}));
