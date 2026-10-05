import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
export function isAccountVideo(file:{type:string;name:string}) {
  return ['video/mp4','video/quicktime','video/x-m4v'].includes(file.type)||(!file.type||file.type==='application/octet-stream')&&/\.(mov|mp4|m4v)$/i.test(file.name);
}
export function videoContainer(bytes:Buffer) {
  if(bytes.length<24||bytes.toString('ascii',4,8)!=='ftyp')throw Error('Не удалось прочитать видео. Выберите MP4 или MOV.');
  const end=bytes.readUInt32BE(0);
  if(end<16||end>bytes.length||end>256)throw Error('Не удалось прочитать видео.');
  const brands=bytes.subarray(8,end);
  if(brands.includes(Buffer.from('qt  ')))return 'mov';
  if(['isom','iso2','mp41','mp42','avc1','M4V '].some(brand=>brands.includes(Buffer.from(brand))))return 'mp4';
  throw Error('Выберите видео MP4 или MOV.');
}
export async function prepareAccountVideo(bytes:Buffer,quicktime=false) {
  const container=videoContainer(bytes);
  if(container==='mp4'&&!quicktime)return bytes;
  const directory=await mkdtemp(join(tmpdir(),'account-video-'));
  try {
    const source=join(directory,'source.mov'),output=join(directory,'video.mp4');
    await writeFile(source,bytes);
    // No shell, remote protocols, playlists or external media references.
    await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist','file,pipe','-f','mov','-i',source,'-map','0:v:0','-map','0:a:0?','-vf',"scale='min(720,iw)':-2",'-c:v','libx264','-threads','2','-preset','fast','-crf','29','-pix_fmt','yuv420p','-c:a','aac','-b:a','64k','-movflags','+faststart','-fs',String(32*1024*1024+1),output],{timeout:90000,maxBuffer:256*1024});
    const result=await readFile(output);
    if(result.length>=32*1024*1024)throw Error('Видео слишком большое. Сократите его и повторите загрузку.');
    return result;
  } catch(error) {
    if(error instanceof Error&&error.message.startsWith('Видео слишком'))throw error;
    throw Error('Не удалось подготовить MOV. Попробуйте короткое видео или загрузите MP4.');
  } finally {await rm(directory,{recursive:true,force:true});}
}
