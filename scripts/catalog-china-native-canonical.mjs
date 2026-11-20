import {parseArgs} from 'node:util';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {buildChinaCanonicalFromNative} from './lib/china-native-canonical.mjs';

globalThis.fetch=async()=>{throw Error('china_native_canonical:network_disabled');};
const {values}=parseArgs({options:{
 native:{type:'string'},authority:{type:'string'},out:{type:'string'},
 'native-sha':{type:'string'},'disposition-sha':{type:'string'},'inputs-sha':{type:'string'},'replacement-sha':{type:'string'},'prepare-stage':{type:'string'},
}});
if(!values.native||!values.authority||!values.out)throw Error('usage: --native --authority --out --native-sha --disposition-sha --inputs-sha');
const out=path.resolve(values.out);
const staged=values['prepare-stage']?path.resolve(values['prepare-stage']):undefined;
if(staged&&(staged===out||staged.startsWith(out+path.sep)||out.startsWith(staged+path.sep)))throw Error('china_native_canonical:stage_path');
const report=await buildChinaCanonicalFromNative({
 nativeRoot:path.resolve(values.native),authorityRoot:path.resolve(values.authority),out,
 nativeSha256:values['native-sha'],dispositionSha256:values['disposition-sha'],inputsSha256:values['inputs-sha'],replacementSha256:values['replacement-sha'],
});
if(!staged)console.log(JSON.stringify(report));
else{
 // One offline job from separately authenticated final disposition to one
 // ready serving folder. This does not create a V2 verdict or publish it.
 const script=fileURLToPath(new URL('./catalog-china-archive-shadow.mjs',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,['--import','tsx',script,'prepare','--archive',out,
  '--expect-sha',report.expectSha256,'--shadow',staged],{maxBuffer:1024*1024});
 const ready=JSON.parse(stdout);
 if(ready.status!=='offline_shadow_activated'||ready.archiveSha256!==report.expectSha256||ready.rows!==report.admitted||
    ready.privateBlocks!==report.blocks||!/^([a-f0-9]{64})$/.test(ready.runtimeReadySha256??''))
  throw Error('china_native_canonical:stage_readback');
 console.log(JSON.stringify({...report,status:'offline_native_serving_folder_ready',stage:ready}));
}
