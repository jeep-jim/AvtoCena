import assert from 'node:assert/strict';
import {createRequire,isBuiltin} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const [repo,out,role='positive']=process.argv.slice(2);
const proofRepo=repo;
assert.ok(role==='positive'||role==='removal');
const sha='22867cbcfaee27b2e8917b6bf880e44827f67b60';
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
const h=b=>createHash('sha256').update(b).digest('hex');
// Embed the precise Next production React cache provider the sidecar had
// used, not the Next module tree. Standalone output tracing may omit the
// require target. Preserve the official module's license and CJS semantics
// and leave the runtime's own cache untouched if it already has one.
const lock=JSON.parse(await fs.readFile(path.join(root,'package-lock.json'),'utf8'));
const PINNED_NEXT='15.5.28';
const PINNED_NEXT_INTEGRITY='sha512-JjhLBBY1PNnuwPtcZ7t8yxVeJVYvD2Jyp633J+gRCNbzSt7N0E+xqCf6uQiff3+3qmUkwcF/ksfSsK1xsZ76Tw==';
const REACT_CACHE_FALLBACK_SHA='125bcbc3a09182b916dce9d7e0d4b1b569f8e994f4bb98ae0d54855f9b74bfb7';
const lockedNext=lock.packages['node_modules/next'];
assert.equal(lockedNext.version,PINNED_NEXT);
assert.equal(lockedNext.integrity,PINNED_NEXT_INTEGRITY);
assert.equal(require('next/package.json').version,PINNED_NEXT);
assert.equal(require('react/package.json').version,lock.packages['node_modules/react'].version);
const reactFallback=await fs.readFile(require.resolve('next/dist/compiled/react/cjs/react.production.js'));
assert.equal(h(reactFallback),REACT_CACHE_FALLBACK_SHA,'exact locked Next production React provider');
const entry=await fs.readFile(new URL(role==='removal'?'./native-removal-preview.mts':'./private-preview-entry.ts',import.meta.url),'utf8');
const removalWire=role==='removal'?await fs.readFile(new URL('./removal-witness.mjs',import.meta.url),'utf8'):'';
// Only the exact readers run here. Transitive modules contain Next request,
// mutable cache, image or GEO branches; never call them or return surrogate
// data just to make a standalone proof work.
const guardImport="import {deny} from 'china-preview-scope-guard';";
const quarantine={
 'china-owner-removal-witness':removalWire,
 'china-preview-scope-guard':`let wrong;export function deny(scope){wrong??=scope;assertQuarantineUntouched()}
 export function assertQuarantineUntouched(){if(wrong)throw Error('preview_forbidden_'+wrong)}`,
 'next/headers':guardImport+`const no=()=>deny('next_headers');export const headers=no,cookies=no,draftMode=no;`,
 'next/cache':guardImport+`const no=()=>deny('next_cache');export const unstable_cache=()=>no,revalidatePath=no,revalidateTag=no,unstable_noStore=no;`,
 'next/server':guardImport+`const no=()=>deny('next_server');export const NextResponse=new Proxy(no,{get:no}),NextRequest=no,after=no;`,
 sharp:guardImport+`export default function no(){return deny('image')}`,
 'geoip-country':guardImport+`module.exports=new Proxy({},{get(){return deny('geoip')}});`,
};
const built=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root,sourcefile:'operator-private-preview.ts',loader:'ts'},
 tsconfig:path.join(root,'apps/web/tsconfig.json'),packages:'external',platform:'node',
 format:'cjs',target:'node24',bundle:true,write:false,metafile:true,legalComments:'none',
 banner:{js:`try {
  const r=require('react');
  if (typeof r.cache!=='function') {
   const m={exports:{}};
   (function(module,exports){
${reactFallback.toString('utf8')}
   })(m,m.exports);
   if (typeof m.exports.cache!=='function') throw Error('exact_next_react_cache_unavailable');
   r.cache=m.exports.cache;
  }
  if (typeof r.cache!=='function') throw Error('exact_next_react_cache_unavailable');
 `},
 footer:{js:String.raw` } catch(e) {
  if(require.main!==module)throw e;
  const msg=e instanceof Error?e.message:'',code=e&&e.code;
  const missing=msg.match(/^Cannot find module ['"]([^'"]+)['"]/);
  const modules={'react':'react','next/dist/compiled/react':'next_compiled_react','next/cache':'next_cache','next/headers':'next_headers','next/server':'next_server','sharp':'sharp','geoip-country':'geoip_country'};
  const reason=(code==='MODULE_NOT_FOUND'||code==='ERR_MODULE_NOT_FOUND')?
   (missing&&Object.hasOwn(modules,missing[1])?'module_'+modules[missing[1]]:'module_untraced'):
   msg==='exact_next_react_cache_unavailable'?'react_cache_unavailable':
   /^Could not load the "sharp" module using the linuxmusl-(?:x64|arm64) runtime/.test(msg)?'sharp_alpine_runtime':
   ['EACCES','EPERM','ENOENT','ENOTDIR','ELOOP'].includes(code)?'fs_'+code.toLowerCase():'boot_failed';
  console.error(JSON.stringify({kind:'private-china-candidate-refused',phase:'boot',reason}));process.exitCode=2;
 }`},
 loader:{'.css':'empty'},plugins:[{name:'server-only-marker',setup(b){
  b.onResolve({filter:/^server-only$/},()=>({path:'server-only-marker',namespace:'readonly-operator'}));
  b.onLoad({filter:/./,namespace:'readonly-operator'},()=>({contents:'',loader:'js'}));
  b.onResolve({filter:/^(?:next\/(?:headers|cache|server)|sharp|geoip-country|china-preview-scope-guard|china-owner-removal-witness)$/},args=>({path:args.path,namespace:'readonly-unreachable'}));
  b.onLoad({filter:/./,namespace:'readonly-unreachable'},args=>({contents:quarantine[args.path],loader:'js'}));
 }}]});
assert.equal(built.outputFiles.length,1);
const externals=[...new Set(Object.values(built.metafile.outputs).flatMap(o=>o.imports.filter(i=>i.external).map(i=>i.path)))].sort();
assert.ok(externals.every(name=>isBuiltin(name)||name==='react'),'unsafe external standalone dependency: '+externals.filter(name=>!isBuiltin(name)&&name!=='react').join(','));
assert.ok(!Object.keys(built.metafile.inputs).some(name=>name.endsWith('/api/catalog/search/route.ts')),'private proof must not boot Next HTTP route');
const inputPaths=[...Object.keys(built.metafile.inputs),'apps/web/tsconfig.json','package-lock.json'];
for(const rel of new Set(inputPaths)){
 if(rel==='operator-private-preview.ts'||(rel.startsWith('readonly-operator:')||rel.startsWith('readonly-unreachable:')))continue;
 assert.ok(!path.isAbsolute(rel)&&!rel.startsWith('../'),rel);
 const file=path.join(root,rel);
 assert.equal(await fs.realpath(file),file,rel);
 assert.equal(git('hash-object','--',file).trim(),git('rev-parse',sha+':'+rel).trim(),rel);
}
const bytes=Buffer.from(built.outputFiles[0].contents);
assert.ok(bytes.length<8*1024*1024);
assert.ok(!bytes.includes("require('next/dist/compiled/react")&&!bytes.includes('require("next/dist/compiled/react'),'no runtime resolution of omitted Next React');
assert.ok(bytes.includes(reactFallback),'exact official cache provider remains byte-identical');
await fs.writeFile(out,bytes,{flag:'wx',mode:0o400});
console.log(JSON.stringify({kind:'private-china-source-bundle-built',appSha:sha,bytes:bytes.length,
 toolVersion:version,bundleSha256:h(bytes),operatorSourceSha256:h(entry),embeddedReactCacheSha256:REACT_CACHE_FALLBACK_SHA,nextVersion:PINNED_NEXT,privateProof:'exact-prepared-core-readers',role,frameworkExternals:externals.filter(name=>!isBuiltin(name)&&name!=='react'),inputFiles:Object.keys(built.metafile.inputs).length}));
