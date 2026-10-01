export const AUTOCALC_MARKETS = {japan:'Япония',china:'Китай',korea:'Корея',uae:'ОАЭ',europe:'Европа',georgia:'Грузия'};
// Only advertise direct links after a successful detail-page probe, not a homepage HTTP 200.
export const VERIFIED_LINK_SOURCES = [
 {market:'georgia',name:'AutoPapa',href:'https://autopapa.ge/en/',checkedAt:'2026-09-27'},
 {market:'korea',name:'K Car',href:'https://www.kcar.com/bc/search',checkedAt:'2026-09-27'},
 {market:'uae',name:'DubiCars',href:'https://www.dubicars.com/uae/used',checkedAt:'2026-09-27'},
 {market:'europe',name:'AutoScout24',href:'https://www.autoscout24.com/lst',checkedAt:'2026-09-27'},
];
export function sourceIdentity(value:string):{market:string;ids:string[];id:string}|null {
 let u:URL;try{u=new URL(value);}catch{return null;}
 const host=u.hostname.replace(/^www\./,'');let id='';
 if(/(^|\.)autohome\.com\.cn$/.test(host) && (id=u.pathname.match(/^\/(?:config\/)?spec\/(\d+)(?:\.html|\/)?$/)?.[1]||''))return {market:'china',ids:['autohome_new_china_open'],id};
 if(host==='autopapa.ge' && (id=u.pathname.match(/^\/en\/(?:usd\/)?[^/]+\/[^/]+\/(\d{5,})\/?$/)?.[1]||''))return {market:'georgia',ids:['autopapa_georgia_open'],id};
 if(/(^|\.)encar\.com$/.test(host) && (id=u.pathname.match(/\/cars\/detail\/(\d+)/)?.[1]||u.searchParams.get('carid')||'') && /^\d+$/.test(id))return {market:'korea',ids:['encar_direct'],id};
 if(host==='global.che168.com' && (id=u.pathname.match(/^\/en\/detail\/(\d+)/)?.[1]||''))return {market:'china',ids:['autohome_used_china_open'],id};
 if(host==='jptrade.ru' && (id=u.pathname.match(/^\/stat\/(\d+)/)?.[1]||''))return {market:'japan',ids:['jptrade_japan_stat'],id};
 if(host==='dubicars.com' && (id=u.pathname.match(/-(\d+)\.html$/)?.[1]||''))return {market:'uae',ids:['dubicars_uae_exact'],id};
 if(host==='kcar.com' && (id=u.searchParams.get('i_sCarCd')||'') && /^EC\d+$/.test(id))return {market:'korea',ids:['kcar_korea_open'],id};
 if(/(^|\.)myauto\.ge$/.test(host) && (id=u.pathname.match(/\/(?:pr|product|car)\/(\d+)/)?.[1]||''))return {market:'georgia',ids:['myauto_georgia_list','myauto_georgia_open'],id};
 if(/(^|\.)che168\.com$/.test(host) && (id=u.pathname.match(/\/(\d+)\.html$/)?.[1]||''))return {market:'china',ids:['autohome_used_china_open','che168_dealer_exact','che168_china_exact'],id};
 if(/(^|\.)autoscout24\.(com|de|nl|fr|it|be|at|es)$/.test(host) && (id=u.pathname.match(/([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i)?.[1]||''))return {market:'europe',ids:['autoscout_europe_open'],id};
 if(/(^|\.)mobile\.de$/.test(host) && (id=u.searchParams.get('id')||'') && /^\d+$/.test(id))return {market:'europe',ids:['mobile_de_open'],id};
 if(host==='demo.pro-auctions.ru' && (id=u.pathname.match(/^\/statistika\/[^/]+\/[^/]+\/(\d+)\.html$/)?.[1]||''))return {market:'japan',ids:['proauctions_japan_stat'],id};
 return null;
}
