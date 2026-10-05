import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
const require = createRequire(import.meta.url);
// Isolate only persistence and the Next request context. Auth, hashes, cookie
// issuance, rate limits, validation and public account serialization stay real.
export async function customerAuthHarness() {
  const state = {records:new Map(), context:new AsyncLocalStorage(), failWrites:false};
  globalThis.__customerAuthTest = state;
  const result = await build({entryPoints:['apps/web/app/api/account/auth/route.ts'],bundle:true,platform:'node',format:'cjs',packages:'external',write:false,plugins:[{name:'isolated-account-storage',setup(b){
    b.onResolve({filter:/^(next\/headers|@\/lib\/data|\.\.\/data)$/}, a=>({path:a.path==='next/headers'?'headers':'data',namespace:'auth-test'}));
    b.onLoad({filter:/.*/,namespace:'auth-test'},a=>({loader:'js',contents:a.path==='headers'
      ? 'export const cookies=async()=>({get:name=>{const value=globalThis.__customerAuthTest.context.getStore()?.[name];return value?{value}:undefined}});'
      : `const state=globalThis.__customerAuthTest;
        export class StorageConflictError extends Error {}
        export const readDataJson=async(path,fallback)=>structuredClone(state.records.get(path)??fallback);
        export const getJsonStorage=()=>({writeJson:async(path,value,condition)=>{if(state.failWrites)throw Error('unavailable');if(condition?.ifNoneMatch==='*'&&state.records.has(path))throw new StorageConflictError();state.records.set(path,structuredClone(value));}});
        export const mutateDataJson=async(path,fallback,update)=>{const value=await update(await readDataJson(path,fallback));state.records.set(path,structuredClone(value));return value;};`
    }));
  }}]});
  const module={exports:{}};
  new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
  return {state, handle(request){const cookies=Object.fromEntries((request.headers.get('cookie')||'').split(';').map(item=>{const at=item.indexOf('=');return [item.slice(0,at).trim(),item.slice(at+1)];}));return state.context.run(cookies,()=>request.method==='GET'?module.exports.GET():module.exports.POST(request));}};
}
