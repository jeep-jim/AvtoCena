export const SITE_SECTIONS = [
 {id:'home',label:'Главная',description:'Главная страница сайта.',href:'/',selectors:''},
 {id:'catalog',label:'Каталог автомобилей',description:'Каталог, фильтры и карточки автомобилей.',href:'/cars',selectors:'a[href="/cars"],a[href^="/cars?"]'},
 {id:'dealers',label:'Дилеры',description:'Список и публичные страницы компаний.',href:'/dealers',selectors:'a[href="/dealers"]',edit:'/crm/dealers'},
 {id:'specials',label:'Спецпредложения',description:'Автомобили дилеров под заказ.',href:'/',selectors:'[data-site-block="specials"]',edit:'/crm/dealers'},
 {id:'stock',label:'Автомобили в наличии',description:'Предложения дилеров в наличии.',href:'/',selectors:'[data-site-block="stock"]',edit:'/crm/dealers'},
 {id:'rates',label:'Курсы валют',description:'Блок актуальных курсов на страницах сайта.',href:'/',selectors:'.ac-currency-rates-strip',edit:'/crm/settings'},
 {id:'partners',label:'Партнёрам',description:'Подключение дилеров и поставщиков.',href:'/partners',selectors:'a[href^="/partners"]',legacy:'partnersEnabled'},
 {id:'knowledge',label:'База знаний',description:'Инструкции покупателям и партнёрам.',href:'/knowledge',selectors:'a[href^="/knowledge"]',legacy:'knowledgeEnabled'},
 {id:'affiliates',label:'ОСАГО и кредит',description:'Финансовые сервисы и ссылки.',href:'/osago',selectors:'.ac-home-finance,.ac-public-footer-affiliates,.ac-offer-finance-cards,.ac-credit-calculator-mock,[data-offer-credit-host],[data-offer-finance-cards-host],a[href^="https://affid.ru/"],a[href="/autocredit"],a[href="/osago"]',legacy:'affiliatesEnabled'},
 {id:'autocalc',label:'АвтоКалькулятор',description:'Самостоятельный расчёт автомобиля.',href:'/autocalc',selectors:'a[href="/autocalc"]'},
] as const;
export type SiteSection=typeof SITE_SECTIONS[number]['id'];
export type SiteRule={desktop:boolean;mobile:boolean;title?:string;description?:string};
export type SiteControls=Partial<Record<SiteSection,SiteRule>>;
export function siteRule(features:any,id:SiteSection):SiteRule{
 const section=SITE_SECTIONS.find(s=>s.id===id)!;
 const legacy='legacy' in section?features?.[section.legacy]:undefined;
 const enabled=legacy===undefined?!['partners','knowledge'].includes(id):legacy===true;
 const value=features?.siteControls?.[id];
 return {desktop:enabled&&value?.desktop!==false,mobile:enabled&&value?.mobile!==false,title:String(value?.title||'').slice(0,120),description:String(value?.description||'').slice(0,600)};
}
export function normalizeSiteControls(value:unknown):SiteControls{
 const raw=value&&typeof value==='object'?value as Record<string,any>:{};
 return Object.fromEntries(SITE_SECTIONS.filter(s=>raw[s.id]).map(s=>{const v=raw[s.id];if(typeof v.desktop!=='boolean'||typeof v.mobile!=='boolean')throw Error('Укажите видимость на обоих устройствах');return [s.id,{desktop:v.desktop,mobile:v.mobile,title:String(v.title||'').trim().slice(0,120),description:String(v.description||'').trim().slice(0,600)}];}));
}
export function siteRoute(path:string):SiteSection|null{
 if(path==='/')return 'home';
 if(path==='/partners'||path.startsWith('/partners/'))return 'partners';
 if(path==='/knowledge'||path.startsWith('/knowledge/'))return 'knowledge';
 if(path==='/osago'||path==='/autocredit')return 'affiliates';
 if(path==='/autocalc')return 'autocalc';
 if(path==='/cars'||path.startsWith('/cars/'))return 'catalog';
 if(path==='/dealers'||path.startsWith('/dealers/'))return 'dealers';
 return null;
}
export function siteVisibilityCss(features:any){
 const ratesLayout=siteRule(features,'affiliates').desktop?'':`@media(min-width:1024px){.ac-home-page .ac-home-services{grid-template-columns:minmax(0,1fr)}.ac-home-services>.ac-currency-rates-strip{grid-column:1 / -1;min-width:0}.ac-home-services .ac-currency-rates-grid{grid-template-columns:repeat(10,minmax(0,1fr))}}`;
 return SITE_SECTIONS.map(s=>{const r=siteRule(features,s.id);return (['desktop','mobile'] as const).map(device=>r[device]?'':`@media(${device==='desktop'?'min':'max'}-width:${device==='desktop'?768:767}px){${s.selectors?s.selectors+',':''}[data-site-page="${s.id}"]:not(:has([data-site-preview="true"]))>[data-site-content]{display:none!important}[data-site-page="${s.id}"]:not(:has([data-site-preview="true"]))>[data-site-disabled]{display:block!important}}`).join('');}).join('')+ratesLayout;
}
