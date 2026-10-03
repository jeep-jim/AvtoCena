'use client';
import {DealerColorField} from './DealerColorField';
import {DealerPowerFields} from './DealerPowerFields';
import {DealerDeliveryEditor} from './DealerDeliveryEditor';
import {DealerRateEditor} from './DealerRateEditor';
import {Car,Plus,ChevronDown,HelpCircle,Check} from 'lucide-react';
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
 useEffect(()=>{const header=document.querySelector<HTMLElement>(".crm-header");const update=()=>document.documentElement.style.setProperty("--dealer-fold-top",`${header&&getComputedStyle(header).display!=="none"?header.getBoundingClientRect().height+12:8}px`);update();const observer=new ResizeObserver(update);if(header)observer.observe(header);window.addEventListener("resize",update);return()=>{observer.disconnect();window.removeEventListener("resize",update);};},[]);
 const rateMode=useRef(s.pricing.rateMode);rateMode.current=s.pricing.rateMode;
 const visible=s.offers.filter(x=>offerAvailability(x)===mode);
 const o=visible.find(x=>x.id===activeId)||visible[0];
 const stock=mode==='stock';
 const heading=offerSectionHeading(s,mode);
 const subtitle=stock?s.stockSubtitle||'':s.specialSubtitle||'';
 const subtitleEnabled=(stock?s.stockSubtitleEnabled:s.specialSubtitleEnabled)===true;
 const complete={data:!!o?.make.trim()&&!!o?.model.trim()&&!!o&&Number.isInteger(o.year)&&o.year>=1900&&o.year<=new Date().getFullYear()&&(stock||(Number.isInteger(o.productionMonth)&&o.productionMonth>=1&&o.productionMonth<=12&&Date.UTC(o.year,o.productionMonth-1,1)<=Date.now())),photos:!!o?.photos.length,specs:!!o&&!!o.transmission&&!!o.drive&&!!o.body&&!!o.color&&!!o.powerHp&&(o.fuel==='electric'||!!o.engineCc)&&calculateSpecial(s,o).complete};
 const required=(k:string)=>{if(!o)return false;if(k==='engineCc')return o.fuel!=='electric'&&!(o.engineCc>0);if(k==='power30MinKw')return !stock&&['electric','series_hybrid','hybrid'].includes(o.fuel)&&!(o.power30MinKw>0);if(k==='year')return !Number.isInteger(o.year)||o.year<1900||o.year>new Date().getFullYear();if(k==='productionMonth')return !stock&&(!Number.isInteger(o.productionMonth)||o.productionMonth<1||o.productionMonth>12||Date.UTC(o.year,o.productionMonth-1,1)>Date.now());return ['make','model','transmission','drive','body','color'].includes(k)&&!String(o[k as keyof SpecialOffer]||'').trim();};
 const enabled=stock?s.stockEnabled===true:s.specialsEnabled;
 const [help,setHelp]=useState(false);
 const [rateStatus,setRateStatus]=useState(''),[rateBusy,setRateBusy]=useState(false);
 async function refreshRate(force=false){
  if(demo){setRateStatus('В демо используется пример курса. Рабочие настройки не меняются.');return;}
  setRateBusy(true);
  try{const r=await fetch(`/api/dealers/exchange-rate${force?'?dealerId='+encodeURIComponent(s.dealerId):''}`,{cache:'no-store',...(force?{method:'POST'}:{})});const data=await r.json();if(!r.ok)throw Error(data.error);if(rateMode.current==='manual'&&!force)return;if(data.quote){pricing({usdRub:data.quote.value,rateAt:data.quote.quoteAt,rateSource:data.quote.source,...(force?{rateMode:'auto' as const}:{})});setRateStatus(data.error||`Курс получен ${new Date(data.quote.fetchedAt).toLocaleString('ru-RU')}`);}else setRateStatus(data.error||'Источник пока не передал курс. Можно временно указать его вручную.');}
  catch{setRateStatus('Не удалось обновить курс. Проверьте соединение или укажите курс вручную.');}finally{setRateBusy(false);}
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
    <div className="dealer-heading-controls"><div className="dealer-rail-switch"><Toggle label="Показывать предложения компании" value={enabled} onChange={v=>patch(stock?{stockEnabled:v}:{specialsEnabled:v})}/><span>{enabled?'Включено':'Скрыто'}</span></div><Toggle label="Подзаголовок" value={subtitleEnabled} onChange={v=>patch(stock?{stockSubtitleEnabled:v}:{specialSubtitleEnabled:v})}/></div>
    <Field label="Заголовок ленты" value={heading} maxLength={50} onChange={v=>patch(stock?{stockHeading:v.slice(0,50)}:{specialHeading:v.slice(0,50)})}/>
    <p className="mt-1 text-xs text-[var(--ac-muted)]">{heading.length} / 50</p>
    {subtitleEnabled&&<div><Field label="Подзаголовок ленты" value={subtitle} maxLength={70} onChange={v=>patch(stock?{stockSubtitle:v.slice(0,70)}:{specialSubtitle:v.slice(0,70)})}/><p className="mt-1 text-xs text-[var(--ac-muted)]">{subtitle.length} / 70 · Появится под заголовком меньшим шрифтом</p></div>}
    <p className="text-xs text-[var(--ac-muted)]">Посетителям видны опубликованные авто. Черновики — только вам.</p>
   </section>
  </>}
  {section==='pricing'&&<section className="dealer-editor-panel space-y-5">
   <h2 className="text-lg font-black">Цена и доставка собственных автомобилей</h2>
   <DealerRateEditor value={s.pricing} onChange={pricing} busy={rateBusy} status={rateStatus} onRefresh={()=>void refreshRate(true)}/>
   <div className="dealer-pricing-section"><h4>Услуги компании</h4><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{([['deliveryMarkupRub','К доставке, ₽'],['commissionRub','Комиссия, ₽'],['documentsRub','СБКТС + ЭПТС, ₽']] as const).map(([k,label])=><Field key={k} label={label} type="number" value={s.pricing[k]} onChange={v=>pricing({[k]:v})}/>)}</div></div>
   <DealerDeliveryEditor value={s.pricing} city={s.pricing.baseCity||''} defaultDestination onCityChange={baseCity=>pricing({baseCity})} onChange={pricing}/>
   <p className="dealer-pricing-note">Доставка в рублях = тариф в $ × курс для расчёта + надбавка к доставке.</p>
  </section>}
  {section==='offers'&&<>
   <details className="dealer-editor-panel dealer-fold" open>
    <summary><h2>{heading}</h2><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary>
    {subtitleEnabled&&subtitle&&<p className="mb-4 text-sm text-[var(--ac-muted)]">{subtitle}</p>}<div className="dealer-offer-list">{visible.map(item=>{const price=calculateSpecial(s,item).totalRub;return <button type="button" key={item.id} className="dealer-offer-tile" aria-pressed={o?.id===item.id} onClick={()=>setActiveId(item.id)}>{item.photos[0]?<img src={item.photos[0].url} alt=""/>:<span className="dealer-offer-empty"><Car size={54}/></span>}<div><strong>{specialTitle(item)||'Марка, модель, год'}</strong><small>{item.status==='published'?'Опубликован':item.status==='sold'?'Продан':'Черновик'} · {item.photos.length} фото{price?` · ${price.toLocaleString('ru-RU')} ₽`:''}</small></div></button>})}<button type="button" className="dealer-offer-tile dealer-offer-add" disabled={s.offers.length>=200} aria-label="Добавить автомобиль" onClick={()=>add()}><span className="dealer-offer-empty"><Plus size={58}/></span><div><strong>Добавить автомобиль</strong><small>{stock?'Новый или с пробегом':'Новый под заказ'}</small></div></button></div>
   </details>
   {o&&<div className="dealer-offer-fields" key={o.id}>
    <details className="dealer-editor-panel dealer-fold" data-complete={complete.data} open><summary><h3>{complete.data&&<span className="dealer-section-check" aria-label="Заполнено"><Check size={20}/></span>}01 · Данные автомобиля</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><div className="space-y-4">
    <details><summary className="cursor-pointer text-sm font-bold py-3">Заполнить из объявления по ссылке</summary><DealerOfferImport dealerId={s.dealerId} offer={o} onChange={v=>updateOffer(o.id,v)}/></details>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     {([['make','Марка','text'],['model','Модель','text'],['trim','Комплектация','text'],['year','Год выпуска','number'],['productionMonth','Месяц производства (1–12)','number']] as const).filter(([k])=>!stock||k!=='productionMonth').map(([k,label,type])=><Field key={k} label={label} type={type} invalid={required(k)} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     {stock&&<label className="grid gap-1 text-sm">Состояние<select aria-label="Состояние" className={input} value={o.condition||'new'} onChange={e=>updateOffer(o.id,{condition:e.target.value as 'new'|'used'})}><option value="new">Новый</option><option value="used">С пробегом</option></select></label>}
     <label className="grid gap-1 text-sm">Статус<select aria-label="Статус" className={input} value={o.status} onChange={e=>updateOffer(o.id,{status:e.target.value as SpecialOffer['status']})}><option value="draft">Черновик / шаблон</option><option value="published">Опубликован</option><option value="sold">Продан</option></select></label>
    </div>
    <ResearchLink label="Алиса — найти характеристики и комплектацию" query={`Найди официальные характеристики и полный список оснащения ${specialTitle(o)} ${o.year||''} ${o.engineCc?`${o.engineCc} см3`:''} ${o.fuel}. Укажи мощность ДВС отдельно от суммарной мощности гибрида и подтверждённую 30-минутную мощность электромоторов, если она есть. Не предполагай неизвестные данные; приложи ссылки на источники.`}/>
    <details className="dealer-knowledge-fold"><summary>Из базы знаний АвтоЦены<ChevronDown size={20}/></summary><KnowledgeSuggestions hideHeading title={o.model} make={o.make} year={o.year?String(o.year):''} market="" disabled={!o.make||!o.model} onChoose={choose} onPreview={()=>{}}/></details>
    </div></details>
    <details className="dealer-editor-panel dealer-fold" data-complete={complete.photos} open><summary><h3>{complete.photos&&<span className="dealer-section-check" aria-label="Заполнено"><Check size={20}/></span>}02 · Фотографии</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><Photos dealerId={s.dealerId} value={o.photos} onChange={photos=>updateOffer(o.id,{photos})}/></details>
    <details className="dealer-editor-panel dealer-fold" data-complete={complete.specs} open><summary><h3>{complete.specs&&<span className="dealer-section-check" aria-label="Заполнено"><Check size={20}/></span>}03 · Характеристики и стоимость</h3><span className="dealer-circle-control"><ChevronDown size={20}/></span></summary><div className="space-y-5"><div className="dealer-pricing-section"><h4>Характеристики</h4><details className="mb-4"><summary className="cursor-pointer py-3 text-sm font-bold">Характеристики по ссылке</summary><DealerOfferImport mode="specs" dealerId={s.dealerId} offer={o} onChange={v=>updateOffer(o.id,v)}/></details><div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
     <DealerPowerFields value={o.powerHp} onChange={powerHp=>updateOffer(o.id,{powerHp})}/>{([['engineCc','Объём, см³','number'],['power30MinKw','30-мин. мощность, кВт','number'],['transmission','Коробка передач','text'],['drive','Привод','text'],['body','Кузов','text'],['color','Цвет','text'],['mileageKm','Пробег, км','number']] as const).filter(([k])=>!stock||k!=='power30MinKw').map(([k,label,type])=>k==='color'?<DealerColorField key={k} value={o.color} invalid={required(k)} onChange={color=>updateOffer(o.id,{color})}/>:<Field key={k} label={label} type={type} invalid={required(k)} value={o[k]} onChange={v=>updateOffer(o.id,{[k]:v})}/>)}
     <label className="grid gap-1 text-sm">Двигатель<select className={input} value={o.fuel} onChange={e=>updateOffer(o.id,{fuel:e.target.value as SpecialOffer['fuel']})}>{[['petrol','Бензин'],['diesel','Дизель'],['electric','Электро'],['hybrid','Параллельный гибрид'],['series_hybrid','Последовательный гибрид']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
     <label className="grid gap-1 text-sm">Руль<select className={input} value={o.steering} onChange={e=>updateOffer(o.id,{steering:e.target.value as 'left'|'right'})}><option value="left">Левый</option><option value="right">Правый</option></select></label>
    </div></div>
    <div className="dealer-pricing-section"><h4>Стоимость автомобиля</h4>
     {stock?<div className="grid grid-cols-2 gap-3"><Field type="number" invalid={!(o.priceRub!>0)} label="Цена автомобиля, ₽" value={o.priceRub||0} onChange={v=>updateOffer(o.id,{priceRub:v})}/><label className="grid gap-1 text-sm">Адрес автомобиля<select aria-invalid={!o.officeId||undefined} aria-label="Адрес автомобиля" className={input} value={o.officeId||''} onChange={e=>updateOffer(o.id,{officeId:e.target.value})}><option value="">Выберите адрес</option>{s.offices.map(office=><option key={office.id} value={office.id}>{office.city}, {office.address}</option>)}</select>{!s.offices.length&&<small>Добавьте адрес в разделе «Адреса».</small>}</label></div>:<>
      <DealerRateEditor value={s.pricing} onChange={pricing} busy={rateBusy} status={rateStatus} onRefresh={()=>void refreshRate(true)}/>
      <div className="grid grid-cols-2 gap-3 mt-4"><Field type="number" invalid={!(o.priceUsd>0)} label="Цена автомобиля, $" value={o.priceUsd} onChange={priceUsd=>updateOffer(o.id,{priceUsd})}/><Field type="number" invalid={!o.customsIncluded&&!(o.customsExtraRub>0)} label="Таможня сверх цены, ₽" value={o.customsExtraRub} onChange={customsExtraRub=>updateOffer(o.id,{customsExtraRub})}/></div>
      <div className="mt-4 space-y-3"><Toggle label="Таможенные платежи включены в закупочную цену" value={o.customsIncluded} onChange={v=>updateOffer(o.id,{customsIncluded:v})}/><Toggle label="Подтверждены условия льготного утильсбора для личного пользования" value={o.personalUseEligible} onChange={v=>updateOffer(o.id,{personalUseEligible:v})}/><p className="dealer-pricing-note">Применимость льготы и 30-минутную мощность нужно подтвердить документами автомобиля.</p></div>
     </>}
    </div>
    {!stock&&<DealerDeliveryEditor value={s.pricing} city={o.defaultCity||s.pricing.baseCity||''} onCityChange={defaultCity=>updateOffer(o.id,{defaultCity})} onChange={pricing}/>}
    <div className="dealer-pricing-section"><h4>Описание и оснащение</h4><div className="space-y-4">
    {([['description','Описание'],['equipment','Комплектация и оснащение']] as const).map(([k,label])=><label key={k} className="grid gap-2 text-sm">{label}<textarea className={input} rows={4} value={o[k]} onChange={e=>updateOffer(o.id,{[k]:e.target.value})}/></label>)}
    </div></div></div></details>
   </div>}
  </>}
 </>;
}
