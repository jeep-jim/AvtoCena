'use client';
import {Car,Plus,ChevronDown,HelpCircle} from 'lucide-react';
import {useDealerDemo} from './DealerDemoContext';
import {useEffect,useState,useRef} from 'react';
import {DealerOfferImport} from './DealerOfferImport';
import {Field,Toggle,Photos,input,button} from './DealerEditorFields';
import {KnowledgeSuggestions} from '../autocalc/KnowledgeSuggestions';
import {ResearchLink} from '../catalog/VehicleResearchLink';
import {specialTitle,calculateSpecial,offerAvailability,offerSectionHeading,type OfferAvailability,type DealerShowcase,type SpecialOffer} from '@/lib/dealers/showcase-model';
import type {KnowledgeChoice} from '@/lib/autocalc/knowledge';
export function newOffer(mode:OfferAvailability="order"): SpecialOffer {
  return {
    id: crypto.randomUUID(),
    status: "draft",
    availability: mode,condition:"new",priceRub:0,officeId:"",
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
type Props={mode?:OfferAvailability;setMode?:(mode:OfferAvailability)=>void;section?:'offers'|'pricing';s:DealerShowcase;patch:(v:Partial<DealerShowcase>)=>void;pricing:(v:Partial<DealerShowcase['pricing']>)=>void;updateOffer:(id:string,v:Partial<SpecialOffer>)=>void;activeId:string;setActiveId:(v:string)=>void};
export function DealerSpecialsEditor({section='offers',mode='order',setMode,s,patch,pricing,updateOffer,activeId,setActiveId}:Props){
 const demo=useDealerDemo();
 const rateMode=useRef(s.pricing.rateMode);rateMode.current=s.pricing.rateMode;
 const visible=s.offers.filter(x=>offerAvailability(x)===mode);
 const o=visible.find(x=>x.id===activeId)||visible[0];
 const stock=mode==='stock';
 const heading=offerSectionHeading(s,mode);
 const enabled=stock?s.stockEnabled===true:s.specialsEnabled;
 const [help,setHelp]=useState(false);
 const [rateStatus,setRateStatus]=useState(''),[rateBusy,setRateBusy]=useState(false);
 async function refreshRate(){
  setRateBusy(true);
  try{const r=await fetch('/api/dealers/exchange-rate',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);if(rateMode.current==='manual')return;if(data.quote){pricing({usdRub:data.quote.value,rateAt:data.quote.quoteAt,rateSource:data.quote.source});setRateStatus(data.error||`Курс получен ${new Date(data.quote.fetchedAt).toLocaleString('ru-RU')}`);}else setRateStatus(data.error||'Источник пока не передал курс. Можно временно указать его вручную.');}
  catch(e){setRateStatus(e instanceof Error?e.message:'Не удалось обновить курс');}finally{setRateBusy(false);}
 }
 useEffect(()=>{if(demo||(section==='offers'&&stock)||s.pricing.rateMode==='manual')return;void refreshRate();const timer=setInterval(()=>void refreshRate(),15*60000);return()=>clearInterval(timer);},[s.pricing.rateMode,section,stock]);
 function add(source?:SpecialOffer){const next={...(source?structuredClone(source):newOffer(mode)),id:crypto.randomUUID(),status:'draft' as const,officeId:source?.officeId||(stock?s.offices[0]?.id||'':''),defaultCity:s.pricing.baseCity||s.pricing.tariffs[0]?.city||'',updatedAt:''};patch({offers:[...s.offers,next]});setActiveId(next.id);}
 function choose(choice:KnowledgeChoice){
  if(!o)return;const d=choice.draft;const next:Partial<SpecialOffer>={};
  for(const k of ['year','engineCc','powerHp','power30MinKw'] as const)if(!o[k]&&Number(d[k])>0)next[k]=Number(d[k]);
  if(!o.make&&choice.make)next.make=choice.make;if(!o.model&&choice.model)next.model=choice.model;
  if(!o.powerHp&&!o.engineCc&&['petrol','diesel','electric','hybrid','series_hybrid'].includes(d.fuel))next.fuel=d.fuel as SpecialOffer['fuel'];
  updateOffer(o.id,next);
 }
 return <>
  {section==='offers'&&<>
   <div className="dealer-offer-mode-row"><button type="button" className="dealer-circle-control" aria-label="О режимах автомобилей" aria-expanded={help} onClick={()=>setHelp(!help)}><HelpCircle size={20}/></button><div className="dealer-offer-mode" role="tablist" aria-label="Наличие автомобилей">{([['order','Новые автомобили под заказ'],['stock','Автомобили в наличии']] as const).map(([kind,label])=><button key={kind} type="button" role="tab" aria-selected={mode===kind} onClick={()=>setMode?.(kind)}>{label}</button>)}</div></div>
   {help&&<p className="text-sm text-[var(--ac-muted)]">Под заказ — расчёт ввоза и доставки. В наличии — новые или подержанные автомобили с ценой в рублях и адресом осмотра.</p>}
   <section className="dealer-editor-panel space-y-4">
    <div className="dealer-rail-switch"><Toggle label="Показывать предложения компании" value={enabled} onChange={v=>patch(stock?{stockEnabled:v}:{specialsEnabled:v})}/><span>{enabled?'Включено':'Скрыто'}</span></div>
    <Field label="Заголовок ленты" value={heading} onChange={v=>patch(stock?{stockHeading:v}:{specialHeading:v})}/>
    <p className="text-xs text-[var(--ac-muted)]">Посетителям видны опубликованные авто. Черновики — только вам.</p>
   </section>
  </>}
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
  {section==='offers'&&<>
   <details className="dealer-editor-panel dealer-fold" open>
    <summary><h2>{heading}</h2><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary>
    <div className="dealer-offer-list">{visible.map(item=>{const price=calculateSpecial(s,item).totalRub;return <button type="button" key={item.id} className="dealer-offer-tile" aria-pressed={o?.id===item.id} onClick={()=>setActiveId(item.id)}>{item.photos[0]?<img src={item.photos[0].url} alt=""/>:<span className="dealer-offer-empty"><Car size={54}/></span>}<div><strong>{specialTitle(item)||'Марка, модель, год'}</strong><small>{item.status==='published'?'Опубликован':item.status==='sold'?'Продан':'Черновик'} · {item.photos.length} фото{price?` · ${price.toLocaleString('ru-RU')} ₽`:''}</small></div></button>})}<button type="button" className="dealer-offer-tile dealer-offer-add" disabled={s.offers.length>=200} aria-label="Добавить автомобиль" onClick={()=>add()}><span className="dealer-offer-empty"><Plus size={58}/></span><div><strong>Добавить автомобиль</strong><small>{stock?'Новый или с пробегом':'Новый под заказ'}</small></div></button></div>
   </details>
   {o&&<div className="dealer-offer-fields" key={o.id}>
    <details className="dealer-editor-panel dealer-fold" open><summary><h3>01 · Данные автомобиля</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><div className="space-y-4">
    <details><summary className="cursor-pointer text-sm font-bold py-3">Заполнить из объявления по ссылке</summary><DealerOfferImport dealerId={s.dealerId} offer={o} onChange={v=>updateOffer(o.id,v)}/></details>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     {([['make','Марка','text'],['model','Модель','text'],['trim','Комплектация','text'],['year','Год выпуска','number'],['productionMonth','Месяц производства (1–12)','number']] as const).filter(([k])=>!stock||k!=='productionMonth').map(([k,label,type])=><Field key={k} label={label} type={type} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     {stock&&<label className="grid gap-1 text-sm">Состояние<select className={input} value={o.condition||'new'} onChange={e=>updateOffer(o.id,{condition:e.target.value as 'new'|'used'})}><option value="new">Новый</option><option value="used">С пробегом</option></select></label>}
     <label className="grid gap-1 text-sm">Статус<select className={input} value={o.status} onChange={e=>updateOffer(o.id,{status:e.target.value as SpecialOffer['status']})}><option value="draft">Черновик / шаблон</option><option value="published">Опубликован</option><option value="sold">Продан</option></select></label>
    </div>
    <ResearchLink label="Алиса — найти характеристики и комплектацию" query={`Найди официальные характеристики и полный список оснащения ${specialTitle(o)} ${o.year||''} ${o.engineCc?`${o.engineCc} см3`:''} ${o.fuel}. Укажи мощность ДВС отдельно от суммарной мощности гибрида и подтверждённую 30-минутную мощность электромоторов, если она есть. Не предполагай неизвестные данные; приложи ссылки на источники.`}/>
    <KnowledgeSuggestions title={o.model} make={o.make} year={o.year?String(o.year):''} market="" disabled={!o.make||!o.model} onChoose={choose} onPreview={()=>{}}/>
    </div></details>
    <details className="dealer-editor-panel dealer-fold" open><summary><h3>02 · Фотографии</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><Photos dealerId={s.dealerId} value={o.photos} onChange={photos=>updateOffer(o.id,{photos})}/></details>
    <details className="dealer-editor-panel dealer-fold" open><summary><h3>03 · Характеристики и стоимость</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><div className="space-y-4"><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     {([['engineCc','Объём, см³','number'],['powerHp','Мощность ДВС / ЭВ, л.с.','number'],['power30MinKw','30-мин. мощность, кВт','number'],['transmission','Коробка передач','text'],['drive','Привод','text'],['body','Кузов','text'],['color','Цвет','text'],['mileageKm','Пробег, км','number'],['priceUsd','Цена автомобиля, $','number'],['customsExtraRub','Таможня сверх цены, ₽','number']] as const).filter(([k])=>!stock||!['priceUsd','customsExtraRub','power30MinKw'].includes(k)).map(([k,label,type])=><Field key={k} label={label} type={type} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     <label className="grid gap-1 text-sm">Двигатель<select className={input} value={o.fuel} onChange={e=>updateOffer(o.id,{fuel:e.target.value as SpecialOffer['fuel']})}>{[['petrol','Бензин'],['diesel','Дизель'],['electric','Электро'],['hybrid','Параллельный гибрид'],['series_hybrid','Последовательный гибрид']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Руль<select className={input} value={o.steering} onChange={e=>updateOffer(o.id,{steering:e.target.value as 'left'|'right'})}><option value="left">Левый</option><option value="right">Правый</option></select></label>
     {stock?<><Field type="number" label="Цена автомобиля, ₽" value={o.priceRub||0} onChange={v=>updateOffer(o.id,{priceRub:v})}/><label className="grid gap-1 text-sm">Адрес автомобиля<select className={input} value={o.officeId||''} onChange={e=>updateOffer(o.id,{officeId:e.target.value})}><option value="">Выберите адрес</option>{s.offices.map(office=><option key={office.id} value={office.id}>{office.city}, {office.address}</option>)}</select>{!s.offices.length&&<small>Добавьте адрес в разделе «Адреса».</small>}</label></>:<div className="text-sm"><span className="text-[var(--ac-muted)]">Цена до базового города</span><p className="mt-2 font-bold">{s.pricing.baseCity||'Выберите город в разделе «Расчёт своих авто»'}</p><p className="mt-2 text-xs text-[var(--ac-muted)]">Доставка в город клиента — отдельно.</p></div>}
    </div>
    {!stock&&<><Toggle label="Таможенные платежи включены в закупочную цену" value={o.customsIncluded} onChange={v=>updateOffer(o.id,{customsIncluded:v})}/>
    <Toggle label="Подтверждены условия льготного утильсбора для личного пользования" value={o.personalUseEligible} onChange={v=>updateOffer(o.id,{personalUseEligible:v})}/>
    <p className="text-xs text-[var(--ac-muted)]">Применимость льготы и 30-минутную мощность нужно подтвердить документами автомобиля.</p></>}
    {([['description','Описание'],['equipment','Комплектация и оснащение']] as const).map(([k,label])=><label key={k} className="grid gap-2 text-sm">{label}<textarea className={input} rows={4} value={o[k]} onChange={e=>updateOffer(o.id,{[k]:e.target.value})}/></label>)}
    </div></details>
   </div>}
  </>}
 </>;
}
