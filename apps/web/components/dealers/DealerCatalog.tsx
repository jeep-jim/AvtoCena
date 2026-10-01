"use client";
import {useEffect,useState} from 'react';
import {CatalogCard} from '@/components/catalog/CatalogCard';
import {DEALER_MARKETS,type DealerMarket} from '@/lib/dealers/catalog-markets';
export function DealerCatalog({markets}:{markets:DealerMarket[]}){
 const [market,setMarket]=useState(markets[0]||'');
 const [make,setMake]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 const [data,setData]=useState<{items:any[];total:number}|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const allowed=markets.includes(market as DealerMarket)?market:markets[0];
 useEffect(()=>{
  if(!allowed)return;
  const controller=new AbortController();setLoading(true);setError('');setData(null);
  const query=new URLSearchParams({market:allowed,page:String(page),pageSize:'12'});if(search)query.set('make',search);
  fetch(`/api/catalog/search?${query}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const value=await r.json();if(!value.ok||!Array.isArray(value.items))throw Error();if(!controller.signal.aborted)setData({items:value.items,total:value.total});}).catch(e=>{if(e.name!=='AbortError')setError('Не удалось загрузить автомобили. Попробуйте ещё раз.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[allowed,page,search,retry]);
 if(!markets.length)return <div className="dealer-empty"><h3>Подберём автомобиль для вас</h3><p>Компания пока не указала направления доставки. Оставьте заявку с моделью и бюджетом.</p></div>;
 return <div className="dealer-catalog">
  <div className="dealer-market-pills" aria-label="Рынки доставки">{DEALER_MARKETS.filter(m=>markets.includes(m.id)).map(m=><button type="button" key={m.id} aria-pressed={allowed===m.id} onClick={()=>{setMarket(m.id);setPage(1);}}><span aria-hidden>{m.flag}</span>{m.label}</button>)}</div>
  <form className="dealer-catalog-search" onSubmit={e=>{e.preventDefault();setSearch(make.trim());setPage(1);}}><label className="sr-only" htmlFor="dealer-make">Марка автомобиля</label><input id="dealer-make" value={make} onChange={e=>setMake(e.target.value)} placeholder="Марка автомобиля"/><button type="submit">Найти</button>{search&&<button type="button" onClick={()=>{setMake('');setSearch('');setPage(1);}}>Сбросить</button>}</form>
  <p className="dealer-muted dealer-catalog-origin">Каталог АвтоЦены · направления доставки компании</p>
  <div aria-live="polite" aria-busy={loading}>{loading?<div className="dealer-catalog-skeleton">{Array.from({length:6},(_,i)=><div key={i}/>)}<span className="sr-only">Загружаем автомобили</span></div>:error?<div className="dealer-empty"><p>{error}</p><button type="button" className="dealer-primary" onClick={()=>setRetry(v=>v+1)}>Повторить</button></div>:data?.items.length?<><div className="dealer-catalog-grid">{data.items.map(o=><CatalogCard key={o.id} offer={o} compact/>)}</div><div className="dealer-pagination"><button type="button" disabled={page===1} onClick={()=>setPage(v=>v-1)}>← Назад</button><span>Страница {page} из {Math.max(1,Math.ceil(data.total/12))}</span><button type="button" disabled={page*12>=data.total} onClick={()=>setPage(v=>v+1)}>Далее →</button></div></>:<div className="dealer-empty"><h3>Автомобили не найдены</h3><p>Выберите другую марку или направление доставки.</p></div>}</div>
 </div>;
}
