import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const root='scripts/publisher-runtime83', meta=JSON.parse(fs.readFileSync(root+'/source-selection.json','utf8'));
const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'});
const baseline=fs.readFileSync('apps/web/lib/catalog/storage.ts','utf8');
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
assert.equal(digest(baseline),meta.baseStorageSha256);
const shadow=fs.readFileSync(root+'/storage.ts','utf8');
const normalized=shadow.replace(/(from\s*|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g,(all,prefix,q,rel)=>{
 if(meta.operationalModules.includes(rel.slice(2)))return all;
 const target=path.posix.normalize(path.posix.join(root,rel));
 let original=path.posix.relative('apps/web/lib/catalog',target);if(!original.startsWith('.'))original='./'+original;
 return prefix+q+original+q;
});
test('shadow is precisely the 11 reviewed operational write hunks, never a budget/calculation port',()=>{
 const diff=fs.readFileSync(root+'/selected-write-hooks.diff','utf8');assert.equal(digest(diff),meta.selectedDiffSha256);let expected=baseline;
 const hunks=diff.split(/(?=^@@ )/m).slice(1).filter(h=>meta.selectedHunks.includes(h.split('\n')[0]));assert.equal(hunks.length,11);
 for(const hunk of hunks){const lines=hunk.split(/(?<=\n)/).slice(1),old=lines.filter(x=>x.startsWith(' ')||x.startsWith('-')).map(x=>x.slice(1)).join(''),next=lines.filter(x=>x.startsWith(' ')||x.startsWith('+')).map(x=>x.slice(1)).join('');assert.equal(expected.split(old).length,2);expected=expected.replace(old,next);}
 assert.equal(normalized,expected);
});
test('all non-writer function bodies and existing imports retain exact83 semantics',()=>{
 const parse=(s:string)=>ts.createSourceFile('storage.ts',s,ts.ScriptTarget.Latest,true);
 const funcs=(s:string)=>new Map(parse(s).statements.filter(ts.isFunctionDeclaration).filter(x=>x.name).map(x=>[x.name!.text,x.getText()]));
 const old=funcs(baseline),next=funcs(normalized),allowed=new Set(['persistInternalCatalog','persistJapanAuctionHistory','persistCatalogOffers','writeCurrentCatalogReadModels']);
 for(const [name,body]of old)if(!allowed.has(name))assert.equal(next.get(name),body,name);
 for(const statement of parse(baseline).statements.filter(ts.isImportDeclaration)) assert.ok(normalized.includes(statement.getText()));
});
test('five raw operational modules byte-match reviewed source and application tree is unchanged',()=>{
 assert.equal(meta.operationalModules.length,5);
 for(const file of meta.operationalModules)assert.equal(digest(fs.readFileSync(root+'/'+file,'utf8')),meta.operationalModuleSha256[file]);
 assert.equal(git('ls-tree','HEAD','--','apps/web/lib','packages').trim(),meta.servingLibraryTrees);
 assert.equal(git('diff','HEAD','--','apps','packages').trim(),'');
});

test('incident publisher rejects every scope except exactly China before any source read',()=>{
 const s=fs.readFileSync('scripts/catalog-publish-market.mjs','utf8'), guard='if (configuredMarkets.length !== 1 || market !== "china") throw Error("catalog_live83_publisher_china_only");';
 assert.ok(s.indexOf(guard)>0&&s.indexOf(guard)<s.indexOf('const generation = await readGenerationFiles()'));
 const check=new Function('configuredMarkets','market',guard);
 check(['china'],'china');
 for(const markets of [[],['korea'],['china','korea'],['all'],['china','china']])assert.throws(()=>check(markets,markets[0]||''),/china_only/);
});
