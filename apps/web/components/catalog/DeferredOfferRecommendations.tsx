"use client";

import {useEffect,useRef,useState} from 'react';
import {DealerLink} from '@/components/dealers/DealerBrowsingContext';
import {CatalogCard} from './CatalogCard';
import {RelatedOffersView} from './RelatedOffersView';
import type {OfferRecommendations} from './recommendation-types';

type Props={offerId?:string;markets?:string[];kind?:'related'|'alternatives'};

function Loading({kind}:{kind:string}) {
  if(kind==='alternatives')return <div className="ac-unavailable-loading" role="status">Подбираем другие автомобили…</div>;
  return <section className="mt-10 md:mt-14" aria-label="Загружаем похожие предложения"><div className="h-9 w-52 animate-pulse rounded-xl bg-white/[0.08]" /><div className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">{Array.from({length:4},(_,index)=><div key={index} className="min-h-64 animate-pulse rounded-[1.35rem] bg-white/[0.045]" />)}</div></section>;
}

// A new identity remounts the loader. Results from the previous car cannot
// populate a client-side navigation to another car.
export function DeferredOfferRecommendations(props:Props) {
  return <DeferredRecommendations key={[props.kind,props.offerId,props.markets?.join(',')].join(':')} {...props}/>;
}

function DeferredRecommendations({offerId='',markets,kind='related'}:Props) {
  const root=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false);
  const [attempt,setAttempt]=useState(0);
  const [data,setData]=useState<OfferRecommendations|null>(null);
  const [status,setStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const marketKey=markets?.join(',');

  useEffect(()=>{
    const element=root.current;
    if(!element||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();setVisible(true);}
    },{rootMargin:'240px'});
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);

  useEffect(()=>{
    if(!visible)return;
    const controller=new AbortController();let mounted=true;
    const timeout=setTimeout(()=>controller.abort(),20000);
    const query=new URLSearchParams({kind});
    if(offerId)query.set('id',offerId);
    if(marketKey!==undefined)query.set('markets',marketKey);
    setStatus('loading');
    fetch('/api/catalog/recommendations?'+query,{signal:controller.signal,cache:'no-store',credentials:'same-origin'})
      .then(async response=>{
        if(!response.ok)throw Error('recommendations_unavailable');
        const result:OfferRecommendations=await response.json();
        if(result.kind!==kind)throw Error('recommendations_invalid');
        if(mounted){setData(result);setStatus('ready');}
      })
      .catch(()=>{if(mounted)setStatus('error');})
      .finally(()=>clearTimeout(timeout));
    return ()=>{mounted=false;clearTimeout(timeout);controller.abort();};
  },[visible,attempt,offerId,marketKey,kind]);

  const retry=()=>{setVisible(true);setAttempt(value=>value+1);};
  return <div ref={root} data-deferred-recommendations={kind} aria-busy={status==='loading'}>
    {data?.kind==='related'&&<RelatedOffersView data={data} markets={markets}/>}
    {data?.kind==='alternatives'&&data.items.length>0&&<section className="ac-unavailable-alternatives" aria-labelledby="offer-alternatives-title"><div className="ac-unavailable-section-heading"><h2 id="offer-alternatives-title">{data.title}</h2></div><div className="ac-unavailable-grid">{data.items.map(row=><CatalogCard key={row.id} offer={row} compact/>)}</div></section>}
    {!data&&status!=='error'&&<Loading kind={kind}/>}
    {(status==='error'||data?.partial)&&<p className="mt-5 text-[var(--ac-muted)]" role="status">{data?'Часть похожих предложений пока не загрузилась.':'Не удалось загрузить похожие предложения.'} <button type="button" className="underline" disabled={status==='loading'} onClick={retry}>Повторить</button></p>}
    {status==='idle'&&<button type="button" className="mt-3 underline" onClick={retry}>Показать похожие предложения</button>}
    <noscript><DealerLink href="/cars">Посмотреть другие автомобили</DealerLink></noscript>
  </div>;
}
