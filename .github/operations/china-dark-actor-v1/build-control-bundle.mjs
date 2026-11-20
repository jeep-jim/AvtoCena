import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire,isBuiltin} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const [input,proof,out]=process.argv.slice(2),base='f4dc98aaab916b29419d173994d66562aa5901f1';
assert.ok([input,proof,out].every(p=>path.isAbsolute(p)));
const root=await fs.realpath(input),gitRoot=await fs.realpath(proof);
const git=(...args)=>execFileSync('git',args,{cwd:gitRoot,encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd();
assert.equal(git('rev-parse',base+'^{commit}'),base);
const require=createRequire(path.join(root,'package.json'));
const {build,version}=require('esbuild'),sha=b=>createHash('sha256').update(b).digest('hex');
const seed='scripts/catalog-china-own-control-switch-host.mts';
const overlay=new Set([seed,'scripts/catalog-china-own-control-switch.ts','apps/web/lib/catalog/china-regcloud-cut-switch.ts']);
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
assert.equal(version,lock.packages['node_modules/esbuild'].version,'build tool from exact locked dependency');
const result=await build({absWorkingDir:root,entryPoints:[seed],bundle:true,write:false,metafile:true,platform:'node',
 format:'esm',target:'node24',tsconfig:path.join(root,'apps/web/tsconfig.json'),legalComments:'none',
 alias:{'server-only':'next/dist/compiled/server-only/empty','@opentelemetry/api':'next/dist/compiled/@opentelemetry/api'},
 banner:{js:'import {createRequire as __chinaCreateRequire} from "node:module"; const require=__chinaCreateRequire(import.meta.url);'},
 plugins:[{name:'no-image-work-in-operator',setup(b){
  b.onResolve({filter:/^sharp$/},()=>({path:'operator-image-code-forbidden',namespace:'china-switch'}));
  b.onLoad({filter:/./,namespace:'china-switch'},()=>({loader:'js',
   contents:'export default function forbidden(){throw Error("china_dark_switch:image_work_not_authorized");}'}));
 }}]});
assert.equal(result.outputFiles.length,1);
for(const o of Object.values(result.metafile.outputs))
 for(const i of o.imports)if(i.external)assert.ok(isBuiltin(i.path),'unbundled runtime dependency: '+i.path);
const gitPaths=new Map(git('ls-tree','-r',base).split('\n').map(l=>[l.split('\t')[1],l.split(' ')[2].split('\t')[0]]));
const sources=[],packageBits=[];
for(const rel of [...new Set([...Object.keys(result.metafile.inputs),'apps/web/tsconfig.json','package.json','package-lock.json'])].sort()){
 if(rel.startsWith('china-switch:'))continue;
 const file=path.resolve(root,rel),bytes=await fs.readFile(file);
 if(rel.includes('node_modules/')){
  packageBits.push([rel.slice(rel.lastIndexOf('node_modules/')+13),sha(bytes)]);continue;
 }
 assert.ok(!rel.startsWith('../')&&!path.isAbsolute(rel)&&await fs.realpath(file)===file,rel);
 const oid=git('hash-object','--',file);
 if(!overlay.has(rel))assert.equal(oid,gitPaths.get(rel),rel);
 sources.push([rel,oid,sha(bytes),overlay.has(rel)]);
}
assert.equal(sources.filter(x=>x[3]).length,overlay.size);
const bytes=result.outputFiles[0].contents;
assert.ok(bytes.length>0&&bytes.length<8*1024*1024);
await fs.writeFile(out,bytes,{flag:'wx',mode:0o500});
const receipt={version:1,kind:'china-dark-host-bundle-v1',base,esbuildVersion:version,sha256:sha(bytes),
 bytes:bytes.length,projectInputs:sources.length,packageInputs:packageBits.length,projectClosureSha256:sha(JSON.stringify(sources)),
 packageClosureSha256:sha(JSON.stringify(packageBits)),overlay:sources.filter(x=>x[3]).map(([file,gitBlob,sha256])=>({file,gitBlob,sha256})),
 externalModules:'node-builtins-only',imageTransforms:'disabled-fail-closed'};
await fs.writeFile(out+'.inputs.json',JSON.stringify({receipt,sources,packageBits}),{flag:'wx',mode:0o600});
console.log(JSON.stringify(receipt));
