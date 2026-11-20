import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const [repo,out,proofRepo=repo]=process.argv.slice(2);
const sha='85296f6b8797aaa93227b69da7e9e9e928e8f9b5';
const git=(...a)=>execFileSync('git',a,{cwd:proofRepo,encoding:'utf8',maxBuffer:32*1024*1024});
assert.ok(path.isAbsolute(repo)&&path.isAbsolute(out));
assert.equal(git('rev-parse',sha+'^{commit}').trim(),sha);
if(proofRepo===repo){
 assert.equal(git('rev-parse','HEAD').trim(),sha);
 assert.equal(git('status','--porcelain','--untracked-files=no').trim(),'');
}
const root=await fs.realpath(repo);
const require=createRequire(path.join(root,'package.json'));
const {build,version}=require('esbuild');
const entry=await fs.readFile(new URL('./private-preview-entry.ts',import.meta.url),'utf8');
const built=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,sourcefile:'operator-private-preview.ts',loader:'ts'},
 tsconfig:path.join(root,'apps/web/tsconfig.json'),packages:'external',platform:'node',
 format:'cjs',target:'node24',bundle:true,write:false,metafile:true,legalComments:'none',
 banner:{js:"{const r=require('react'); if (typeof r.cache!=='function') r.cache=require('next/dist/compiled/react').cache; if(typeof r.cache!=='function') throw Error('exact_next_react_cache_unavailable');}"},
 loader:{'.css':'empty'},plugins:[{name:'server-only-marker',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'server-only-marker',namespace:'readonly-operator'}));
  b.onLoad({filter:/./,namespace:'readonly-operator'},()=>({contents:'',loader:'js'}));
 }}]});
assert.equal(built.outputFiles.length,1);
const inputPaths=[...Object.keys(built.metafile.inputs),'apps/web/tsconfig.json','package-lock.json'];
for(const rel of new Set(inputPaths)){
 if(rel==='operator-private-preview.ts'||rel.startsWith('readonly-operator:'))continue;
 assert.ok(!path.isAbsolute(rel)&&!rel.startsWith('../'),rel);
 const file=path.join(root,rel);
 assert.equal(await fs.realpath(file),file,rel);
 assert.equal(git('hash-object','--',file).trim(),git('rev-parse',sha+':'+rel).trim(),rel);
}
const bytes=built.outputFiles[0].contents;
assert.ok(bytes.length<8*1024*1024);
const h=b=>createHash('sha256').update(b).digest('hex');
await fs.writeFile(out,bytes,{flag:'wx',mode:0o400});
console.log(JSON.stringify({kind:'private-china-source-bundle-built',appSha:sha,bytes:bytes.length,
 toolVersion:version,bundleSha256:h(bytes),operatorSourceSha256:h(entry),inputFiles:Object.keys(built.metafile.inputs).length}));
