import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence';
import {proAuctionsIdentity} from '../apps/web/lib/catalog/proauctions-import';
import {proAuctionsRetryableDependencyError} from '../scripts/lib/proauctions-collection-stop.mjs';

test('only transient dependency failures and explicit refusals are retryable',()=>{
 for(const error of [new Error('http_503'),new TypeError('fetch failed'),new Error('TimeoutError'),Object.assign(new Error('access_403'),{access:true})])assert.equal(proAuctionsRetryableDependencyError(error),true);
 for(const error of [new Error('http_404'),new Error('unsupported image format'),new Error('identity mismatch')])assert.equal(proAuctionsRetryableDependencyError(error),false);
});

for(const dependency of ['photo','witness','legacy-photo','sheet','legacy-sheet'])test(`${dependency} refusal preserves the lot across a real collector restart`,async()=>{
 const repo=process.cwd(),root=await fs.mkdtemp(path.join(os.tmpdir(),'proauctions-resume-'));
 const url='https://demo.pro-auctions.ru/statistika/mazda/cx-5/30162134.html';
 let html=['ProAuctions','Статистика','Mazda','CX-5'].map(value=>`<span itemprop="name">${value}</span>`).join('')+await fs.readFile(path.join(repo,'tests/fixtures/proauctions/30162134.html'),'utf8');
 if(dependency.includes('sheet')){
  const initial=parseProAuctionsDetailEvidence(html,url);
  const sheet=new URL('auction-sheet-test.webp',initial.imageUrls[0]).href;
  html+=`<h2>Аукционный лист</h2><div class="list-img"><img src="${sheet}"></div>`;
 }
 const e=parseProAuctionsDetailEvidence(html,url),identity=proAuctionsIdentity(html,e);
 const date=e.identity.auctionDate.split('-').reverse().join('-');
 const witness=`<button data-marka="${identity.make}" data-model="${identity.model}"></button>Статус:<span>продано</span>Дата:<span>${date}</span>Год<span>${e.identity.year}</span>Кузов:<span>${e.identity.chassis}</span>Лот:<span>${e.identity.lotNumber}</span>Аукцион:<span>${e.identity.auctionName}</span>Последняя ставка:<span>${e.price.amountJpy}</span>`;
 try{
  await fs.writeFile(path.join(root,'detail.html'),html);await fs.writeFile(path.join(root,'witness.html'),witness);
  for(const [i,color] of ['red','blue','green'].entries())await sharp({create:{width:200,height:150,channels:3,background:color}}).png().toFile(path.join(root,`${i}.png`));
  await fs.writeFile(path.join(root,'mock.mjs'),`
import fs from 'node:fs/promises';
const clock=Date.now,offset=${Date.parse(e.identity.auctionDate)+86400000}-clock();
Date.now=()=>clock()+offset;
let image=0;
globalThis.fetch=async(input)=>{
 const url=String(input);await fs.appendFile('requests.log',url+'\\n');
 if(url.includes('/statistika/?page='))return new Response('<a href="${url}">lot</a>');
 if(url==='${url}')return new Response(await fs.readFile('detail.html'));
 if(url.startsWith('https://jptrade.ru/'))return process.env.FAIL_DEPENDENCY==='witness'?new Response('',{status:403}):new Response(await fs.readFile('witness.html'));
 if(/^https:\\/\\/jp\\d+\\.pa-server\\.ru\\//.test(url))return (process.env.FAIL_DEPENDENCY==='photo'||process.env.FAIL_DEPENDENCY==='sheet'&&url===${JSON.stringify(e.auctionSheetUrls[0])})?new Response('',{status:403}):new Response(await fs.readFile(String(image++%3)+'.png'));
 throw Error('Unexpected request: '+url);
};`);
  const run=(failure:string)=>spawnSync(process.execPath,['--import',createRequire(path.join(repo,'package.json')).resolve('tsx'),'--import',path.join(root,'mock.mjs'),path.join(repo,'scripts/collect-proauctions.mjs')],{cwd:root,env:{...process.env,PROAUCTIONS_DURABLE:'0',PROAUCTIONS_OUTPUT:'proauctions-collection',PROAUCTIONS_MAX_DETAILS:'1',PROAUCTIONS_SECONDS:'10',FAIL_DEPENDENCY:failure},encoding:'utf8',timeout:30000});
  const first=run(dependency.replace('legacy-',''));assert.equal(first.status,1,first.stderr+first.stdout);
  const checkpoint=()=>fs.readFile(path.join(root,'proauctions-collection/checkpoint.json'),'utf8').then(JSON.parse);
  const failed=await checkpoint();assert.equal(failed.stopReason,'source_access_refused');assert.deepEqual(failed.done,[]);assert.deepEqual(failed.pending,[url]);assert.equal(failed.details,0);
  const raw=JSON.parse(await fs.readFile(path.join(root,'proauctions-collection/raw/30162134.json'),'utf8'));assert.equal(raw.retryPending,true);
  if(dependency.includes('sheet'))assert.equal(failed.prepared,1,'a prepared offer with missing sheet remains retryable');
  if(dependency.startsWith('legacy-')){
   // Reproduce an older checkpoint that incorrectly considered the failed lot done.
   delete failed.dependencyRetryVersion;failed.done=[url];failed.pending=[];failed.details=1;failed.complete=true;
   delete raw.retryPending;
   await fs.writeFile(path.join(root,'proauctions-collection/checkpoint.json'),JSON.stringify(failed));
   await fs.writeFile(path.join(root,'proauctions-collection/raw/30162134.json'),JSON.stringify(raw));
  }
  const second=run('');assert.equal(second.status,0,second.stderr+second.stdout);
  const recovered=await checkpoint();assert.deepEqual(recovered.done,[url]);assert.deepEqual(recovered.pending,[]);assert.equal(recovered.prepared,1);assert.equal(recovered.details,1);
  const offer=JSON.parse(await fs.readFile(path.join(root,'proauctions-collection/offers/30162134.json'),'utf8'));assert.equal(offer.sourcePrice,e.price.amountJpy);assert.ok(offer.images.length>=2);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
