import {readFile} from 'node:fs/promises';
import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 if(!isPlatformOwner(await getCurrentUser()))return reply({error:'Доступ запрещён'},403);
 try{
  const sample=JSON.parse(await readFile('/run/avtocena-metrics/resources.json','utf8'));
  if(sample.version!==1 || !Number.isFinite(sample.sampledAt) || Date.now()-sample.sampledAt>20000 || sample.sampledAt>Date.now()+5000)throw Error('stale');
  for(const metric of [sample.memory,sample.disk])if(!metric||!['total','used','available'].every(key=>Number.isFinite(metric[key])&&metric[key]>=0)||metric.total<=0)throw Error('invalid');
  if(!Number.isFinite(sample.cpu?.usedPercent)||sample.cpu.usedPercent<0||sample.cpu.usedPercent>100)throw Error('cpu');
  return reply({...sample,storage:{limitGb:1000,usage:null}});
 }catch{return reply({error:'Показатели временно недоступны. Обновляем соединение.'},503);}
}
