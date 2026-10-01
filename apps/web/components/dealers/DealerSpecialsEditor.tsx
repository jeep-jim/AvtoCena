'use client';
import {Car,Plus} from 'lucide-react';
import {useDealerDemo} from './DealerDemoContext';
import {useEffect,useState,useRef} from 'react';
import {DealerOfferImport} from './DealerOfferImport';
import {Field,Toggle,Photos,input,button} from './DealerEditorFields';
import {KnowledgeSuggestions} from '../autocalc/KnowledgeSuggestions';
import {ResearchLink} from '../catalog/VehicleResearchLink';
import {specialTitle,type DealerShowcase,type SpecialOffer} from '@/lib/dealers/showcase-model';
import type {KnowledgeChoice} from '@/lib/autocalc/knowledge';
export function newOffer(): SpecialOffer {
  return {
    id: crypto.randomUUID(),
    status: "draft",
    make: "",
    model: "",
    trim: "",
    year: 0,
    productionMonth: 0,
    engineCc: 0,
    powerHp: 0,
    power30MinKw: 0,
    fuel: "petrol",
    transmission: "",
    drive: "",
    body: "",
    color: "",
    steering: "left",
    mileageKm: 0,
    description: "",
    equipment: "",
    photos: [],
    priceUsd: 0,
    customsIncluded: false,
    customsExtraRub: 0,
    personalUseEligible: false,
    defaultCity: "",
    updatedAt: "",
  };
}
type Props={section?:'offers'|'pricing';s:DealerShowcase;patch:(v:Partial<DealerShowcase>)=>void;pricing:(v:Partial<DealerShowcase['pricing']>)=>void;updateOffer:(id:string,v:Partial<SpecialOffer>)=>void;activeId:string;setActiveId:(v:string)=>void};
export function DealerSpecialsEditor({section='offers',s,patch,pricing,updateOffer,activeId,setActiveId}:Props){
 const demo=useDealerDemo();
 const rateMode=useRef(s.pricing.rateMode);rateMode.current=s.pricing.rateMode;
 const o=s.offers.find(x=>x.id===activeId)||s.offers[0];
 const [rateStatus,setRateStatus]=useState(''),[rateBusy,setRateBusy]=useState(false);
 async function refreshRate(){
  setRateBusy(true);
  try{const r=await fetch('/api/dealers/exchange-rate',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);if(rateMode.current==='manual')return;if(data.quote){pricing({usdRub:data.quote.value,rateAt:data.quote.quoteAt,rateSource:data.quote.source});setRateStatus(data.error||`Курс получен ${new Date(data.quote.fetchedAt).toLocaleString('ru-RU')}`);}else setRateStatus(data.error||'Источник пока не передал курс. Можно временно указать его вручную.');}
  catch(e){setRateStatus(e instanceof Error?e.message:'Не удалось обновить курс');}finally{setRateBusy(false);}
 }
 useEffect(()=>{if(demo||s.pricing.rateMode==='manual')return;void refreshRate();const timer=setInterval(()=>void refreshRate(),15*60000);return()=>clearInterval(timer);},[s.pricing.rateMode]);
 function add(source?:SpecialOffer){const next={...(source?structuredClone(source):newOffer()),id:crypto.randomUUID(),status:'draft' as const,defaultCity:s.pricing.baseCity||s.pricing.tariffs[0]?.city||'',updatedAt:''};patch({offers:[...s.offers,next]});setActiveId(next.id);}
 function choose(choice:KnowledgeChoice){
  if(!o)return;const d=choice.draft;const next:Partial<SpecialOffer>={};
  for(const k of ['year','engineCc','powerHp','power30MinKw'] as const)if(!o[k]&&Number(d[k])>0)next[k]=Number(d[k]);
  if(!o.make&&choice.make)next.make=choice.make;if(!o.model&&choice.model)next.model=choice.model;
  if(!o.powerHp&&!o.engineCc&&['petrol','diesel','electric','hybrid','series_hybrid'].includes(d.fuel))next.fuel=d.fuel as SpecialOffer['fuel'];
  updateOffer(o.id,next);
 }
 return <>
  {section==='offers'&&<section className="dealer-editor-panel space-y-4">
   <Toggle label="Показывать предложения компании" value={s.specialsEnabled} onChange={v=>patch({specialsEnabled:v})}/>
   <Field label="Заголовок ленты" value={s.specialHeading} onChange={v=>patch({specialHeading:v})}/>
   <p className="text-xs text-[var(--ac-muted)]">На сайте и в миниаппе показываются сохранённые автомобили со статусом «Опубликован». Черновики видны только владельцу.</p>
  </section>}
  {section==='pricing'&&<section className="dealer-editor-panel space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">Цена и доставка собственных автомобилей</h2><a className="text-xs text-red-500 underline" href="https://www.profinance.ru/chart/usdrub/" target="_blank" rel="noreferrer">Курс ProFinance ↗</a></div>
   <Toggle label="Автоматически обновлять курс USD/RUB" value={s.pricing.rateMode!=='manual'} onChange={v=>pricing({rateMode:v?'auto':'manual'})}/>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
    {s.pricing.rateMode==='manual'?<Field type="number" label="Курс USD/RUB" value={s.pricing.usdRub} onChange={v=>pricing({usdRub:v,rateAt:new Date().toISOString()})}/>:<div className="rounded-xl bg-[var(--ac-surface-2)] p-3"><p className="text-xs text-[var(--ac-muted)]">USD/RUB</p><strong className="text-xl">{s.pricing.usdRub||'—'}</strong></div>}
    {([['fxMarkupRub','К курсу, ₽'],['deliveryMarkupRub','К доставке, ₽'],['commissionRub','Комиссия, ₽'],['documentsRub','СБКТС + ЭПТС, ₽']] as const).map(([k,label])=><Field key={k} label={label} type="number" value={s.pricing[k]} onChange={v=>pricing({[k]:v})}/>)}
    <div className="rounded-xl bg-[var(--ac-surface-2)] p-3"><p className="text-xs text-[var(--ac-muted)]">Курс для расчёта</p><strong className="text-xl">{s.pricing.usdRub?(s.pricing.usdRub+s.pricing.fxMarkupRub).toLocaleString('ru-RU'):'—'} ₽</strong></div>
   </div>
   {s.pricing.rateMode!=='manual'&&<div className="flex flex-wrap items-center gap-3"><button className={button} type="button" disabled={rateBusy} onClick={()=>void refreshRate()}>{rateBusy?'Обновляем…':'Проверить курс'}</button><p className="text-xs text-[var(--ac-muted)]">{rateStatus||'Курс обновляется автоматически каждые 15 минут.'}</p></div>}
   <label className="grid gap-2 text-sm font-bold">Город базовой цены<select className={input} value={s.pricing.baseCity||''} onChange={e=>pricing({baseCity:e.target.value})}><option value="">Выберите город</option>{s.pricing.tariffs.map(t=><option key={t.id}>{t.city}</option>)}</select></label><p className="text-sm text-[var(--ac-muted)]">Цена всех ваших автомобилей считается до этого города. Выбор города посетителем её не меняет. Доставка дальше согласуется отдельно.</p>
   <h3 className="font-bold">Стоимость доставки до базового города</h3>
   {s.pricing.tariffs.map((t,i)=><div key={t.id} className="grid grid-cols-2 items-end gap-3 rounded-xl border border-[var(--ac-border)] p-3 lg:grid-cols-[1.5fr_1fr_.7fr_.7fr_auto]">
    {([['city','Город','text'],['usd','Доставка, $','number'],['daysFrom','От, дней','number'],['daysTo','До, дней','number']] as const).map(([k,label,type])=><Field key={k} label={label} type={type} value={t[k]} onChange={v=>pricing({tariffs:s.pricing.tariffs.map((x,n)=>n===i?{...x,[k]:v}:x)})}/>)}
    <button type="button" className={button} aria-label={`Удалить тариф ${t.city}`} onClick={()=>pricing({tariffs:s.pricing.tariffs.filter((_,n)=>n!==i)})}>×</button>
   </div>)}
   <button type="button" className={button} onClick={()=>pricing({tariffs:[...s.pricing.tariffs,{id:crypto.randomUUID(),city:'',usd:0,daysFrom:5,daysTo:10}]})}>+ Добавить город доставки</button>
   <p className="text-xs text-[var(--ac-muted)]">Доставка в рублях = тариф в $ × курс для расчёта + надбавка к доставке. Тариф задаётся один раз для города и применяется ко всем автомобилям.</p>
  </section>}
  {section==='offers'&&<section className="dealer-editor-panel space-y-4">
   <div className="flex flex-wrap justify-between gap-2"><h2 className="text-lg font-black">Автомобили</h2><button type="button" className={button} onClick={()=>add()}>+ Добавить автомобиль</button></div>
   {!s.offers.length&&<p className="text-sm text-[var(--ac-muted)]">Добавьте автомобиль, заполните характеристики и загрузите фото. Кнопка «Сохранить черновик автомобиля» сохранит незавершённую карточку. Базовая стоимость и доставка настраиваются в разделе «Расчёт своих авто».</p>}
   <div className="dealer-offer-list">{s.offers.map(item=><button type="button" key={item.id} className="dealer-offer-tile" aria-pressed={o?.id===item.id} onClick={()=>setActiveId(item.id)}>{item.photos[0]?<img src={item.photos[0].url} alt=""/>:<span className="dealer-offer-empty"><Car size={30}/></span>}<div><strong>{specialTitle(item)||'Новый автомобиль'}</strong><small>{item.status==='published'?'Опубликован':item.status==='sold'?'Продан':'Черновик'} · {item.photos.length} фото</small></div></button>)}</div>
   {o&&<div className="space-y-4" key={o.id}>
    <h3 className="dealer-step-title">01 · Данные автомобиля</h3>
    <details><summary className="cursor-pointer text-sm font-bold py-3">Заполнить из объявления по ссылке</summary><DealerOfferImport dealerId={s.dealerId} offer={o} onChange={v=>updateOffer(o.id,v)}/></details>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     {([['make','Марка','text'],['model','Модель','text'],['trim','Комплектация','text'],['year','Год выпуска','number'],['productionMonth','Месяц производства (1–12)','number']] as const).map(([k,label,type])=><Field key={k} label={label} type={type} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     <label className="grid gap-1 text-sm">Статус<select className={input} value={o.status} onChange={e=>updateOffer(o.id,{status:e.target.value as SpecialOffer['status']})}><option value="draft">Черновик / шаблон</option><option value="published">Опубликован</option><option value="sold">Продан</option></select></label>
    </div>
    <ResearchLink label="Алиса — найти характеристики и комплектацию" query={`Найди официальные характеристики и полный список оснащения ${specialTitle(o)} ${o.year||''} ${o.engineCc?`${o.engineCc} см3`:''} ${o.fuel}. Укажи мощность ДВС отдельно от суммарной мощности гибрида и подтверждённую 30-минутную мощность электромоторов, если она есть. Не предполагай неизвестные данные; приложи ссылки на источники.`}/>
    <KnowledgeSuggestions title={o.model} make={o.make} year={o.year?String(o.year):''} market="" disabled={!o.make||!o.model} onChoose={choose} onPreview={()=>{}}/>
    <h3 className="dealer-step-title">02 · Фотографии</h3><Photos dealerId={s.dealerId} value={o.photos} onChange={photos=>updateOffer(o.id,{photos})}/>
    <h3 className="dealer-step-title">03 · Характеристики и стоимость</h3><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     {([['engineCc','Объём, см³','number'],['powerHp','Мощность ДВС / ЭВ, л.с.','number'],['power30MinKw','30-мин. мощность, кВт','number'],['transmission','Коробка передач','text'],['drive','Привод','text'],['body','Кузов','text'],['color','Цвет','text'],['mileageKm','Пробег, км','number'],['priceUsd','Цена автомобиля, $','number'],['customsExtraRub','Таможня сверх цены, ₽','number']] as const).map(([k,label,type])=><Field key={k} label={label} type={type} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     <label className="grid gap-1 text-sm">Двигатель<select className={input} value={o.fuel} onChange={e=>updateOffer(o.id,{fuel:e.target.value as SpecialOffer['fuel']})}>{[['petrol','Бензин'],['diesel','Дизель'],['electric','Электро'],['hybrid','Параллельный гибрид'],['series_hybrid','Последовательный гибрид']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Руль<select className={input} value={o.steering} onChange={e=>updateOffer(o.id,{steering:e.target.value as 'left'|'right'})}><option value="left">Левый</option><option value="right">Правый</option></select></label>
     <div className="text-sm"><span className="text-[var(--ac-muted)]">Цена до базового города</span><p className="mt-2 font-bold">{s.pricing.baseCity||'Выберите город в разделе «Расчёт своих авто»'}</p><p className="mt-2 text-xs text-[var(--ac-muted)]">Доставка в город клиента — отдельно.</p></div>
    </div>
    <Toggle label="Таможенные платежи включены в закупочную цену" value={o.customsIncluded} onChange={v=>updateOffer(o.id,{customsIncluded:v})}/>
    <Toggle label="Подтверждены условия льготного утильсбора для личного пользования" value={o.personalUseEligible} onChange={v=>updateOffer(o.id,{personalUseEligible:v})}/>
    <p className="text-xs text-[var(--ac-muted)]">Применимость льготы и 30-минутную мощность нужно подтвердить документами автомобиля.</p>
    {([['description','Описание'],['equipment','Комплектация и оснащение']] as const).map(([k,label])=><label key={k} className="grid gap-2 text-sm">{label}<textarea className={input} rows={4} value={o[k]} onChange={e=>updateOffer(o.id,{[k]:e.target.value})}/></label>)}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>add(o)}>Создать авто по этому шаблону</button><button type="button" className={button} onClick={()=>{if(confirm('Удалить этот автомобиль?'))patch({offers:s.offers.filter(x=>x.id!==o.id)});}}>Удалить автомобиль</button></div>
   </div>}
  </section>}
 </>;
}
