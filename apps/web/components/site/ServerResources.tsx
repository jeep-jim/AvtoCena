'use client';
import {useEffect,useState} from 'react';
import {RegcloudBalance} from './RegcloudBalance';
type Capacity={total:number;used:number;available:number};
type Sample={sampledAt:number;cpu:{usedPercent:number;cores:number};memory:Capacity;disk:Capacity};
const gb=(bytes:number)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(bytes/1024**3);
function Gauge({label,percent,used,free,caption}:{label:string;percent:number;used:string;free:string;caption:string}){
 const p=Math.max(0,Math.min(100,percent));const color=p>90?'#f87171':p>75?'#fbbf24':'#34d399';
 return <div className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5"><div className="flex items-center justify-between gap-4"><div><h3 className="font-bold">{label}</h3><p className="mt-2 text-2xl font-black tabular-nums">{used}</p></div><div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} className="grid h-20 w-20 shrink-0 place-items-center rounded-full" style={{background:`conic-gradient(${color} ${p*3.6}deg,rgba(148,163,184,.15) 0)`}}><div className="grid h-16 w-16 place-items-center rounded-full bg-[var(--ac-bg)] text-lg font-bold tabular-nums">{Math.round(p)}%</div></div></div><p className="mt-3 text-sm font-semibold" style={{color}}>{free}</p><p className="mt-1 text-xs text-[var(--ac-muted)]">{caption}</p></div>;
}
export function ServerResources(){
 const [sample,setSample]=useState<Sample|null>(null),[error,setError]=useState('');
 useEffect(()=>{let stopped=false,timer:ReturnType<typeof setTimeout>;let controller:AbortController;
  async function update(){
   if(document.hidden){timer=setTimeout(update,5000);return;}
   controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8000);
   try{const r=await fetch('/api/crm/server-resources',{cache:'no-store',signal:controller.signal});const value=await r.json();if(!r.ok)throw Error(value.error||'Показатели недоступны');if(!stopped){setSample(value);setError('');}}
   catch{if(!stopped)setError('Нет свежих показателей. Повторяем подключение…');}
   finally{clearTimeout(timeout);if(!stopped)timer=setTimeout(update,5000);}
  }void update();return()=>{stopped=true;clearTimeout(timer);controller?.abort();};
 },[]);
 return <section className="mb-7 rounded-3xl border border-[var(--ac-border)] p-4 md:p-6" aria-label="Ресурсы сервера"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-xl font-black">Мощность сервера</h2><p className="mt-1 text-sm text-[var(--ac-muted)]">Загрузка и свободный запас · обновление каждые 5 секунд</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${error?'bg-amber-500/10 text-amber-500':'bg-emerald-500/10 text-emerald-500'}`} role="status">{error?'Нет связи':sample?'Данные с сервера':'Подключаемся…'}</span></div>{error&&<p className="mb-4 text-sm text-amber-500" role="status">{error} {sample?'Ниже — последний замер.':''}</p>}{sample?<><div className={`grid gap-3 md:grid-cols-3 ${error?'opacity-50':''}`}><Gauge label="Процессор" percent={sample.cpu.usedPercent} used={`${Math.round(sample.cpu.usedPercent)}% занято`} free={`${Math.round(100-sample.cpu.usedPercent)}% свободно`} caption={`${sample.cpu.cores} ядер на сервере`}/><Gauge label="Оперативная память" percent={sample.memory.used/sample.memory.total*100} used={`${gb(sample.memory.used)} ГБ`} free={`${gb(sample.memory.available)} ГБ доступно`} caption={`Всего ${gb(sample.memory.total)} ГБ · доступная память учитывает освобождаемый кеш`}/><Gauge label="Диск сервера" percent={sample.disk.used/sample.disk.total*100} used={`${gb(sample.disk.used)} ГБ`} free={`${gb(sample.disk.available)} ГБ свободно`} caption={`Всего ${gb(sample.disk.total)} ГБ`}/></div><p className="mt-3 text-xs text-[var(--ac-muted)]">Замер: {new Date(sample.sampledAt).toLocaleTimeString('ru-RU')} · объёмы в ГБ по 1024³ байт</p></>:<div className="h-40 animate-pulse rounded-2xl bg-slate-500/10"/>}<div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-[var(--ac-border)] pt-4 text-sm"><span>Хранилище фотографий и данных: лимит <strong>1 000 ГБ</strong><span className="block text-xs text-[var(--ac-muted)]">Лимит указан владельцем. Фактическая занятость — в панели REG.</span></span><a href="https://cloud.reg.ru/" target="_blank" rel="noreferrer" className="font-semibold underline">Панель REG ↗</a></div><RegcloudBalance/></section>;
}
