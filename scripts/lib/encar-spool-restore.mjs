import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {openEncarRawSpoolLifecycle} from './encar-raw-spool-lifecycle.mjs';
import {captureChunkSpool} from './chunk-spool.mjs';
import {localSpoolCache} from './local-spool-cache.mjs';
import {paidEncarSavedPageVerifier} from '../catalog-paid-encar-intake.mjs';
const active=new WeakMap();
export const NORMALIZER_BASE_SOURCE='62dd048cfc492572e204191e7b5ed4bc5c4b478a';
export const NORMALIZER_SHA256='d8c017dfa2e3ebc4a20fdc4339895f578541e498fa21f9e35597e9b03450558a';
export async function prepareRestoreSpool({storage,snapshot,binding,owner,directory,signal,onProgress=async()=>{}}){
 assert.equal(createHash('sha256').update(await fs.readFile(new URL('./paid-encar-offer.mjs',import.meta.url))).digest('hex'),NORMALIZER_SHA256,'spool_normalizer_source_changed');
 assert.ok(path.isAbsolute(directory),'spool_absolute_local_directory');
 const lifecycle=await openEncarRawSpoolLifecycle({storage,binding,owner,readConcurrency:4});
 const cache=await localSpoolCache({directory,store:lifecycle.store,prefix:lifecycle.root+'/',signal});
 try{
  const spool=await captureChunkSpool({enabled:true,upstream:lifecycle.upstream,store:cache,binding,snapshot,verifierFactory:paidEncarSavedPageVerifier,assertAuthority:lifecycle.assertLocalState,assertBatchAuthority:lifecycle.verifyReadGrant,signal,onProgress});
  await lifecycle.seal(spool.manifest);
  await onProgress({stage:"spool_complete_verified",chunks:spool.manifest.chunks.length,pages:binding.pages,rows:spool.manifest.rows,bytes:spool.manifest.bytes});
  const capability=Object.freeze({});active.set(capability,{spool,lifecycle,cache,root:binding.root,closed:false});
  return capability;
 }catch(error){await cache.close();throw error;}
}
function context(capability){const c=active.get(capability);assert.ok(c&&!c.closed,'spool_replay_capability');return c;}
export function replayRestoreStorage(capability,storage){const c=context(capability);return new Proxy(storage,{get(target,key){if(key==='readJson')return (name,fallback)=>{
 context(capability);if(typeof name==='string'&&name.startsWith(c.root+'/')&&/^(pages|page-receipts)\/[1-9]\d*\.json$/.test(name.slice(c.root.length+1)))return c.spool.readJson(name,fallback);
 return target.readJson(name,fallback);
 };const value=target[key];return typeof value==='function'?value.bind(target):value;}});}
export async function finishRestoreReplay(capability){const c=context(capability);await c.spool.finishReplay();}
export async function closeRestoreSpool(capability){const c=context(capability);await c.spool.finishReplay();await c.lifecycle.finishRead();c.closed=true;await c.cache.close();}
