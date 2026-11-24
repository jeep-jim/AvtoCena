import fs from 'node:fs/promises';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PROFILE,ROOT,need,sha256,verifySource,verifyGates,checkInvocation} from './release-contract.mjs';
import {RESOURCE_FILES} from '../home-ui-adapter-20261123/build-image.mjs';
export {RESOURCE_FILES};

export function verifiedBuilder(info){
  need(info?.ServerVersion==='29.1.3'&&info?.Driver==='overlayfs'
    &&Array.isArray(info?.DriverStatus)
    &&info.DriverStatus.some(row=>Array.isArray(row)&&row[0]==='driver-type'&&row[1]==='io.containerd.snapshotter.v1'),'image_builder_store');
  return {version:info.ServerVersion,driver:info.Driver,driverType:'io.containerd.snapshotter.v1'};
}

export async function fileDigest(filename){
  const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');
}
export async function execute(command,args,{cwd,env,log=false,maximum=8*1024*1024}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});
    const parts=[];let bytes=0;
    for(const stream of [child.stdout,child.stderr])stream.on('data',buffer=>{
      if(log)process.stdout.write(buffer);else{bytes+=buffer.length;if(bytes>maximum)child.kill('SIGTERM');else parts.push(buffer);}
    });
    child.once('error',()=>reject(Error('aj_release_command_failed')));
    child.once('close',code=>code===0&&bytes<=maximum?resolve(Buffer.concat(parts)):reject(Error('aj_release_command_failed')));
  });
}

export function checkedImage({inspection,probeLog,sourceProof,archiveSha256,archiveBytes,resourceFiles,controllerSha,builder,roundTripImageId}){
  need(sourceProof.source===PROFILE.source&&sourceProof.tree===PROFILE.tree&&sourceProof.codeDiffSha256===PROFILE.codeDiffSha256,'image_source');
  const c=inspection.Config;
  need(/^sha256:[a-f0-9]{64}$/.test(inspection.Id)&&inspection.Os==='linux'&&inspection.Architecture==='amd64'
    &&Number.isSafeInteger(inspection.Size)&&inspection.Size>0&&c.WorkingDir==='/app'
    &&JSON.stringify(c.Cmd)===JSON.stringify(['node','apps/web/server.js'])
    &&c.Labels?.['org.opencontainers.image.revision']===PROFILE.source
    &&c.Labels?.['org.opencontainers.image.source']==='https://github.com/jeep-jim/AvtoCena'
    &&c.Labels?.['avtocena.application']==='web'&&Object.keys(c.Labels).length===3,'image_config');
  need(builder?.version==='29.1.3'&&builder?.driver==='overlayfs'&&builder?.driverType==='io.containerd.snapshotter.v1'
    &&inspection.Descriptor?.digest===inspection.Id&&roundTripImageId===inspection.Id,'image_portable_identity');
  const rows=String(probeLog).split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const probes=rows.filter(row=>row.stage==='home_image_probe'),memories=rows.filter(row=>row.stage==='node_resource_memory');
  need(probes.length===1&&memories.length===1,'image_probe_records');
  const p=probes[0],m=memories[0];
  need(p.passed===true&&p.nodeVersion==='v24.22.1'&&p.privateIndexInImage===false
    &&p.modelAssetSha256==='ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662','image_probe');
  need(m.nodeVersion==='v24.22.1'&&m.actualHeapBytes>0&&m.actualHeapBytes===m.requestedHeapBytes
    &&m.actualHeapBytes===Math.floor((m.availableRamBytes+m.usableSwapBytes)/1048576)*1048576,'image_memory');
  need(/^[a-f0-9]{64}$/.test(archiveSha256)&&Number.isSafeInteger(archiveBytes)&&archiveBytes>0
    &&/^[a-f0-9]{40}$/.test(controllerSha),'image_receipt_identity');
  need(JSON.stringify(Object.keys(resourceFiles).sort())===JSON.stringify(Object.keys(RESOURCE_FILES).sort())
    &&Object.values(resourceFiles).every(value=>/^[a-f0-9]{64}$/.test(value)),'image_resources');
  return {version:1,status:'verified_aj_japan_image',activationAuthorized:false,source:PROFILE.source,tree:PROFILE.tree,
    sourceCalculationVersion:PROFILE.sourceCalculationVersion,servingCalculationVersion:PROFILE.servingCalculationVersion,
    imageId:inspection.Id,imageArchiveSha256:archiveSha256,imageArchiveBytes:archiveBytes,imageUnpackedBytes:inspection.Size,
    builder,archiveRoundTripVerified:true,
    nodeVersion:p.nodeVersion,modelAssetSha256:p.modelAssetSha256,privateIndexInImage:false,resourceProbePassed:true,
    requestedHeapBytes:m.requestedHeapBytes,actualHeapBytes:m.actualHeapBytes,controllerSha,resourceFiles,sourceProof};
}

export async function buildImage(sourceRoot,directory){
  const invocation=checkInvocation();verifyGates();const proof=verifySource(sourceRoot);
  need(directory===path.join(await fs.realpath(process.env.RUNNER_TEMP),'aj-japan-release'),'image_output');
  await fs.mkdir(directory,{mode:0o700});
  const context=path.join(directory,'context'),resources=path.join(directory,'resources'),dockerConfig=path.join(directory,'docker-config');
  for(const folder of [context,resources,dockerConfig])await fs.mkdir(folder,{mode:0o700});
  const env={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',DOCKER_CONFIG:dockerConfig};
  const archive=path.join(directory,'source.tar');
  await execute('/usr/bin/git',['-C',sourceRoot,'archive','--format=tar','--output='+archive,PROFILE.source],{env});
  await execute('/usr/bin/tar',['--extract','--file',archive,'--directory',context,'--no-same-owner'],{env});
  for(const name of ['.env','.env.local','.env.production','.env.production.local','data/knowledge/encyclopedia/calculation-v1.json']){
    let exists=false;try{await fs.lstat(path.join(context,name));exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    need(!exists,'image_private_input');
  }
  const resourceFiles={};
  for(const [name,source]of Object.entries(RESOURCE_FILES)){
    const raw=await fs.readFile(path.join(ROOT,source));await fs.mkdir(path.dirname(path.join(resources,name)),{recursive:true,mode:0o700});
    await fs.writeFile(path.join(resources,name),raw,{mode:0o400,flag:'wx'});resourceFiles[name]=sha256(raw);
  }
  const tag='avtocena-aj-japan:'+PROFILE.source;
  // The official setup action owns an isolated daemon under this job's temp
  // directory. Never silently build against the runner's different image store.
  const host=process.env.AJ_BUILD_DOCKER_HOST;
  need(typeof host==='string'&&host.startsWith('unix:///'),'image_builder_socket');
  const socketPath=host.slice('unix://'.length),socketRoot=path.join(await fs.realpath(process.env.RUNNER_TEMP),'aj-docker')+path.sep;
  need(socketPath.startsWith(socketRoot)&&await fs.realpath(socketPath)===socketPath
    &&(await fs.stat(socketPath)).isSocket(),'image_builder_socket');
  env.DOCKER_HOST=host;
  const docker=args=>execute('/usr/bin/docker',['--host='+host,...args],{env});
  const builder=verifiedBuilder(JSON.parse(await docker(['info','--format','{{json .}}'])));
  checkInvocation();
  await execute('/usr/bin/docker',['--host='+host,'build','--pull','--platform=linux/amd64','--provenance=false',
    '--label','org.opencontainers.image.revision='+PROFILE.source,
    '--label','org.opencontainers.image.source=https://github.com/jeep-jim/AvtoCena',
    '--label','avtocena.application=web','--tag',tag,context],{env,log:true});
  const inspection=JSON.parse(await docker(['image','inspect','--format','{{json .}}',tag]));
  need(/^sha256:[a-f0-9]{64}$/.test(inspection.Id),'image_identity');
  const probeLog=await docker(['run','--rm','--network','none','--read-only','--entrypoint','node',
    '--env','AVTOCENA_HOME_INHERITED_NODE_OPTIONS=--trace-warnings --max-old-space-size=6144',
    '--mount','type=bind,src='+resources+',dst=/run/avtocena-node-resources,readonly',
    inspection.Id,'/run/avtocena-node-resources/home-bootstrap.mjs','image-probe']);
  const image=path.join(directory,'image.tar');await docker(['image','save','--output',image,tag]);
  need(JSON.parse(await docker(['image','inspect','--format','{{json .}}',tag])).Id===inspection.Id,'image_export_changed');
  // Prove that the archive restores the same content-addressed identity before
  // any server contact. Remove only this fresh image on the disposable daemon.
  await docker(['image','rm',inspection.Id]);
  await docker(['image','load','--input',image]);
  const restored=JSON.parse(await docker(['image','inspect','--format','{{json .}}',inspection.Id]));
  need(restored.Id===inspection.Id&&restored.Descriptor?.digest===inspection.Id,'image_round_trip');
  const receipt=checkedImage({inspection,probeLog,sourceProof:proof,archiveSha256:await fileDigest(image),
    archiveBytes:(await fs.stat(image)).size,resourceFiles,controllerSha:invocation.sourceSha,builder,roundTripImageId:restored.Id});
  await fs.writeFile(path.join(directory,'image-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({stage:'aj_image_ready',source:PROFILE.source,imageId:receipt.imageId,
    imageArchiveSha256:receipt.imageArchiveSha256,hostContacted:false,privateDataPublished:false}));
  return receipt;
}
