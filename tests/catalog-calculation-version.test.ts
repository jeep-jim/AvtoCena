import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {calculationVersion} from '../scripts/catalog-calculation-version.mjs';
import {calculationCacheVersion} from '../apps/web/lib/catalog/shared-budget-prices';

test('calculator identity survives UI releases but follows library, engine, data, dependency changes and deletions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'calculator-version-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe'});
 const write=(file:string,text:string)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);};
 const commit=()=>{git('add','.');git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture');return calculationVersion(root);};
 try{
  git('init');write('apps/web/lib/catalog/shared-budget-prices.ts','initial');write('apps/web/components/Filters.tsx','initial');
  const first=commit();assert.match(first,/^[a-f0-9]{64}$/);
  write('apps/web/components/Filters.tsx','new UI');write('docs/note.md','documentation');
  assert.equal(commit(),first,'a UI/docs commit does not invalidate prepared prices');
  let previous=first;
  for(const file of ['apps/web/lib/catalog/pricing.ts','packages/engine/src/rule.ts','data/fees/tariffs.json','package-lock.json']){
   write(file,'new calculation input');const next=commit();assert.notEqual(next,previous,file);previous=next;
  }
  fs.rmSync(path.join(root,'packages/engine/src/rule.ts'));assert.notEqual(commit(),previous,'deleted dependencies invalidate');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('an absent or malformed calculator identity retains conservative per-release invalidation',()=>{
 const original=process.env.AVTOCENA_CALCULATION_VERSION,release=process.env.AVTOCENA_RELEASE_SHA;
 try{
  process.env.AVTOCENA_RELEASE_SHA='a'.repeat(40);delete process.env.AVTOCENA_CALCULATION_VERSION;
  assert.equal(calculationCacheVersion(),'a'.repeat(40));
  process.env.AVTOCENA_CALCULATION_VERSION='invalid';assert.equal(calculationCacheVersion(),'a'.repeat(40));
  process.env.AVTOCENA_CALCULATION_VERSION='b'.repeat(64);assert.equal(calculationCacheVersion(),'b'.repeat(64));
  process.env.AVTOCENA_RELEASE_SHA='c'.repeat(40);assert.equal(calculationCacheVersion(),'b'.repeat(64));
 }finally{
  if(original===undefined)delete process.env.AVTOCENA_CALCULATION_VERSION;else process.env.AVTOCENA_CALCULATION_VERSION=original;
  if(release===undefined)delete process.env.AVTOCENA_RELEASE_SHA;else process.env.AVTOCENA_RELEASE_SHA=release;
 }
});
