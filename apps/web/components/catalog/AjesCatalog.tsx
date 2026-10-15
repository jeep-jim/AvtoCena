import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CatalogCard} from './CatalogCard';
import {readAjesPublic} from '@/lib/catalog/ajes-public';
import {publicOffer} from '@/lib/catalog/storage';
import {parseEngineCc} from '@/lib/catalog/engine-input';
import type {AjesQuery} from '@/lib/catalog/ajes-query';
import {AjesInputError} from '@/lib/catalog/ajes-query';
type Params=Record<string,string|string[]|undefined>;
const first=(v?:string|string[])=>Array.isArray(v)?v[0]||'':v||'';
const fields=[['make','Марка','text'],['model','Модель','text'],['yearFrom','Год от','number'],['yearTo','Год до','number'],['mileageFrom','Пробег от, км','number'],['mileageTo','Пробег до, км','number'],['engineFrom','Объём от, см³','number'],['engineTo','Объём до, см³','number'],['chassis','Код кузова','text'],['lotNumber','Номер лота','text']] as const;
export async function AjesCatalog({params,embedded=false}:{params:Params;embedded?:boolean}){
 const query:AjesQuery={table:'stats',page:first(params.page)?Number(first(params.page)):1,pageSize:24};
 for(const [key,,type] of fields){const value=first(params[key]);if(value)(query as any)[key]=key==='engineFrom'||key==='engineTo'?(parseEngineCc(value)??NaN):type==='number'?Number(value):value;}
 if(!query.make&&first(params.brand))query.make=first(params.brand);
 const unsupported=['budget','budgetFrom','budgetTo','powerFrom','powerTo','fuel','transmission','drive','bodyType','auctionGrade','hasPrice'].some(key=>Boolean(first(params[key]))) || Boolean(first(params.sort)&&first(params.sort)!=='updatedAt');
 let result:Awaited<ReturnType<typeof readAjesPublic>>|undefined,error='';
 if(unsupported)error='Для завершённых торгов сейчас доступны фильтры ниже. Уберите остальные условия, чтобы увидеть лоты. Стоимость с доставкой можно рассчитать в карточке.';
 else try{result=await readAjesPublic(query);}catch(e){error=e instanceof AjesInputError?'Проверьте диапазоны и названия в фильтрах.':'Японские аукционы временно недоступны. Попробуйте позже или посмотрите автомобили в наличии.';}
 const href=(page:number)=>{const p=new URLSearchParams({market:'japan',page:String(page)});for(const [key]of fields){const v=query[key];if(v!==undefined)p.set(key,String(v));}return '/cars?'+p;};
 return <>{!embedded&&<PublicHeader/>}<main className="mx-auto max-w-7xl px-4 py-8">
 <nav className="mb-5 flex flex-wrap gap-4 text-sm"><Link href="/cars" className="underline">Все рынки</Link><span aria-current="page">Япония · Аукционы</span><Link href="/cars/green" className="underline">Япония · Зелёный угол</Link></nav>
 <h1 className="text-2xl font-bold sm:text-3xl">Автомобили с аукционов Японии</h1>
 <p className="mt-3 max-w-3xl text-sm text-[var(--ac-muted)]">Результаты завершённых торгов. Эти автомобили уже проданы; их цены помогут оценить покупку похожего автомобиля. Цена лота не включает доставку, пошлины и оформление. Расчёт доступен в карточке после уточнения характеристик.</p>
 <form action="/cars" className="my-6 grid grid-cols-2 gap-3 rounded-xl border border-[var(--ac-border)] p-4 sm:grid-cols-3 lg:grid-cols-5">
 <input type="hidden" name="market" value="japan"/>{first(params.dealer)&&<input type="hidden" name="dealer" value={first(params.dealer)}/>}{first(params.preview)==='1'&&<input type="hidden" name="preview" value="1"/>}
 {fields.map(([key,label,type])=><label key={key} className="text-sm">{label}<input name={key} type={type} defaultValue={first(params[key])||(key==='make'?first(params.brand):'')} placeholder={key==='make'?'TOYOTA':key==='model'?'COROLLA':undefined} className="mt-1 block w-full rounded-lg border border-[var(--ac-border)] bg-[var(--ac-surface)] px-3 py-2"/></label>)}
 <button className="rounded-lg bg-[var(--ac-primary)] px-4 py-2 font-semibold">Найти автомобили</button><Link href="/cars?market=japan" className="self-center text-sm underline">Сбросить условия</Link>
 </form>
 {error&&<p role="status" className="rounded-xl border p-5">{error}</p>}
 {result&&<><p className="mb-4 text-sm text-[var(--ac-muted)]">Страница {result.page} · Сначала последние торги</p><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{result.items.map(offer=><CatalogCard key={offer!.id} offer={publicOffer(offer!)}/>)}</div>{!result.items.length&&<p className="py-6">Подходящих автомобилей на этой странице нет. Измените условия поиска.</p>}<nav className="mt-6 flex gap-5" aria-label="Страницы аукционов">{result.page>1&&<Link className="underline" href={href(result.page-1)}>Назад</Link>}{result.received===result.pageSize&&result.page<10000&&<Link className="underline" href={href(result.page+1)}>Далее</Link>}</nav></>}
 </main></>;
}
